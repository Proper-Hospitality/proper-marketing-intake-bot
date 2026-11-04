import { randomBytes } from "node:crypto";
import { searchWorkspaceUsers, searchOpenTasks } from "../tasks/complete.js";
import { addTaskComment, fetchTaskSummary, updateTaskStatus, userFacingAsanaError } from "../intake/asana.js";
import type { FieldMapper } from "../canva/map-fields.js";
import type { SlackApi } from "../slack/api.js";
import type { NormalizedSlackMessage } from "../slack/incoming.js";
import type { Store, ListedTask } from "../store/types.js";
import { statusProposalBlocks, canConfirmStatus, statusComment, type StatusProposal } from "./blocks.js";
import { interpretStatus, proposedChangeLabel, type StatusIntent } from "./intent.js";
import { asanaTaskGids, propertyHints, selectStatusTasks } from "./match.js";
import { mightBeStatusUpdate, nextRateWindow, statusChannelIds } from "./prefilter.js";

const PROPOSAL_TTL_SECONDS = 60 * 60 * 24 * 7;
const SEEN_TTL_SECONDS = 60 * 60 * 24 * 14;

export async function considerStatusUpdate(args: {
  message: NormalizedSlackMessage;
  store: Store;
  slack: SlackApi;
  llm: FieldMapper;
  asanaToken?: string;
  fetchImpl?: typeof fetch;
  channels?: Set<string>;
  now?: number;
}): Promise<"proposed" | "skipped"> {
  const channels = args.channels ?? statusChannelIds();
  if (!channels.has(args.message.channel) || args.message.isDm) return "skipped";
  if (/<@[A-Z0-9]+>/.test(args.message.text)) return "skipped";
  if (!mightBeStatusUpdate(args.message.text)) return "skipped";
  const threadText = await threadContext(args.slack, args.message);
  const text = `${threadText}\n${args.message.text}`.trim();
  const seen = await args.store.claimEvent(`status:msg:${args.message.channel}:${args.message.ts}`, SEEN_TTL_SECONDS);
  if (!seen) return "skipped";
  if (!(await takeRateSlot(args.store, args.message.channel, args.now ?? Date.now()))) return "skipped";
  if (!args.asanaToken) {
    console.error(JSON.stringify({ msg: "status_update_skipped", reason: "no_asana_token" }));
    return "skipped";
  }
  let intent: StatusIntent;
  try {
    intent = await interpretStatus(args.llm, text);
  } catch (error) {
    console.error(JSON.stringify({ msg: "status_intent_failed", error: error instanceof Error ? error.message : "unknown" }));
    return "skipped";
  }
  if (intent.kind === "none") return "skipped";
  const profile = await args.slack.userProfile(args.message.userId);
  const match = await findTasks({
    token: args.asanaToken,
    text,
    intent,
    speakerEmail: profile.email,
    fetchImpl: args.fetchImpl,
  });
  if (match.mode === "none") return "skipped";
  const proposal: StatusProposal = {
    id: `st_${randomBytes(6).toString("hex")}`,
    channel: args.message.channel,
    threadTs: args.message.threadTs || args.message.ts,
    messageTs: args.message.ts,
    speakerId: args.message.userId,
    speakerName: profile.name || "Slack user",
    permalink: (await args.slack.permalink?.(args.message.channel, args.message.ts)) || "",
    intent,
    tasks: match.tasks,
    selectedGid: match.mode === "one" ? match.tasks[0].gid : undefined,
    ephemeral: false,
  };
  await saveProposal(args.store, proposal);
  const view = match.mode === "one" ? "confirm" : "choice";
  const blocks = statusProposalBlocks(proposal, view);
  const fallback = proposedChangeLabel(intent);
  try {
    if (args.slack.postEphemeral) {
      const posted = await args.slack.postEphemeral({
        channel: proposal.channel,
        userId: proposal.speakerId,
        threadTs: proposal.threadTs,
        text: fallback,
        blocks,
      });
      proposal.ephemeral = true;
      proposal.cardTs = posted.ts;
      await saveProposal(args.store, proposal);
      return "proposed";
    }
  } catch (error) {
    console.error(JSON.stringify({ msg: "status_ephemeral_failed", error: error instanceof Error ? error.message : "unknown" }));
  }
  const posted = await args.slack.postMessage({
    channel: proposal.channel,
    threadTs: proposal.threadTs,
    text: fallback,
    blocks,
  });
  proposal.cardTs = posted.ts;
  await saveProposal(args.store, proposal);
  return "proposed";
}

export async function applyStatusAction(args: {
  action: "confirm" | "pick" | "choose" | "dismiss";
  proposalId: string;
  taskGid?: string;
  clickerId: string;
  store: Store;
  slack: SlackApi;
  asanaToken?: string;
  responseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const proposal = await loadProposal(args.store, args.proposalId);
  if (!proposal) {
    await replaceCard(args, undefined, [{ type: "section", text: { type: "mrkdwn", text: "That update expired. Say it again if it should still be filed." } }], "That update expired.");
    return;
  }
  const selected = proposal.tasks.find((task) => task.gid === (args.taskGid || proposal.selectedGid)) ?? proposal.tasks[0];
  const clicker = await args.slack.userProfile(args.clickerId);
  const clickerAsanaGid = await asanaGidForEmail(args.asanaToken, clicker.email, args.fetchImpl);
  const allowed = canConfirmStatus({
    clickerId: args.clickerId,
    speakerId: proposal.speakerId,
    clickerAsanaGid,
    assigneeGid: args.action === "confirm" ? selected?.assigneeGid : undefined,
  }) || (args.action !== "confirm" && proposal.tasks.some((task) => task.assigneeGid && task.assigneeGid === clickerAsanaGid));
  if (!allowed) {
    await replaceCard(args, proposal, statusProposalBlocks(proposal, "denied"), "Only the author or the assignee can confirm.");
    return;
  }
  if (args.action === "dismiss") {
    await replaceCard(args, proposal, statusProposalBlocks(proposal, "dismissed"), "Dismissed.");
    return;
  }
  if (args.action === "pick" || args.action === "choose") {
    if (args.action === "choose" && args.taskGid) proposal.selectedGid = args.taskGid;
    await saveProposal(args.store, proposal);
    const view = args.action === "pick" ? "choice" : "confirm";
    await replaceCard(args, proposal, statusProposalBlocks(proposal, view), "Choose a task.");
    return;
  }
  if (!args.asanaToken || !selected) {
    await replaceCard(args, proposal, statusProposalBlocks(proposal, "failed", "Asana isn't configured."), "Asana isn't configured.");
    return;
  }
  try {
    const change = proposedChangeLabel(proposal.intent);
    if (proposal.intent.kind === "complete") {
      await updateTaskStatus({ token: args.asanaToken, taskGid: selected.gid, completed: true, fetchImpl: args.fetchImpl });
    } else if (proposal.intent.kind === "due") {
      await updateTaskStatus({ token: args.asanaToken, taskGid: selected.gid, dueOn: proposal.intent.dueOn, fetchImpl: args.fetchImpl });
    }
    await addTaskComment({
      token: args.asanaToken,
      taskGid: selected.gid,
      text: statusComment({ name: clicker.name || proposal.speakerName, permalink: proposal.permalink, change }),
      fetchImpl: args.fetchImpl,
    });
    await replaceCard(
      args,
      proposal,
      statusProposalBlocks(proposal, "done", `Updated *${selected.name}*. ${change}\n${selected.url}`),
      `Updated ${selected.name}.`,
    );
  } catch (error) {
    await replaceCard(args, proposal, statusProposalBlocks(proposal, "failed", userFacingAsanaError(error)), "Asana update failed.");
  }
}

async function findTasks(input: {
  token: string;
  text: string;
  intent: Exclude<StatusIntent, { kind: "none" }>;
  speakerEmail?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ mode: "one" | "choice" | "none"; tasks: ListedTask[] }> {
  const linked: ListedTask[] = [];
  for (const gid of asanaTaskGids(input.text)) {
    const task = await fetchTaskSummary({ token: input.token, taskGid: gid, fetchImpl: input.fetchImpl });
    if (task && !task.completed) {
      linked.push({
        gid: task.gid,
        name: task.name,
        assigneeName: task.assigneeName ?? "unassigned",
        assigneeGid: task.assigneeGid,
        projectNames: task.projectNames,
        dueOn: task.dueOn,
        url: task.url,
      });
    }
  }
  const assigneeGid = await asanaGidForEmail(input.token, input.speakerEmail, input.fetchImpl);
  const properties = propertyHints(input.text);
  const query = input.intent.query || properties[0] || "";
  const searched = query
    ? await searchOpenTasks({
      token: input.token,
      assigneeGid,
      filters: { text: query },
      fetchImpl: input.fetchImpl,
    })
    : [];
  return selectStatusTasks({ linked, searched, query, properties, assigneeGid });
}

async function asanaGidForEmail(token: string | undefined, email: string | undefined, fetchImpl?: typeof fetch): Promise<string | undefined> {
  if (!token || !email) return undefined;
  const people = await searchWorkspaceUsers({ token, query: email, fetchImpl });
  return people.find((person) => person.email?.toLowerCase() === email.toLowerCase())?.gid ?? people[0]?.gid;
}

async function threadContext(slack: SlackApi, message: NormalizedSlackMessage): Promise<string> {
  if (!message.threadTs) return "";
  const replies = await slack.threadReplies(message.channel, message.threadTs);
  return replies.map((reply) => reply.text).filter(Boolean).join("\n").slice(0, 2000);
}

async function takeRateSlot(store: Store, channel: string, now: number): Promise<boolean> {
  const key = `status:rate:${channel}`;
  const current = JSON.parse((await store.getValue(key)) || "{}") as { count?: number; windowStart?: number };
  const next = nextRateWindow({
    count: current.count ?? 0,
    windowStart: current.windowStart ?? 0,
    now,
  });
  if (!next.allowed) return false;
  await store.setValue(key, JSON.stringify({ count: next.count, windowStart: next.windowStart }), 600);
  return true;
}

async function saveProposal(store: Store, proposal: StatusProposal): Promise<void> {
  await store.setValue(`status:proposal:${proposal.id}`, JSON.stringify(proposal), PROPOSAL_TTL_SECONDS);
}

async function loadProposal(store: Store, id: string): Promise<StatusProposal | null> {
  const raw = await store.getValue(`status:proposal:${id}`);
  if (!raw) return null;
  return JSON.parse(raw) as StatusProposal;
}

async function replaceCard(
  args: { slack: SlackApi; responseUrl?: string; fetchImpl?: typeof fetch },
  proposal: StatusProposal | undefined,
  blocks: unknown[],
  text: string,
): Promise<void> {
  if (args.responseUrl) {
    await (args.fetchImpl ?? fetch)(args.responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replace_original: true, text, blocks }),
    });
    return;
  }
  if (proposal?.cardTs) {
    await args.slack.updateMessage({ channel: proposal.channel, ts: proposal.cardTs, text, blocks });
  }
}

export function readStatusClick(body: unknown): {
  action: "confirm" | "pick" | "choose" | "dismiss";
  proposalId: string;
  taskGid?: string;
  clickerId: string;
  responseUrl?: string;
} | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as {
    user?: { id?: string };
    response_url?: string;
    actions?: Array<{ action_id?: string; value?: string }>;
  };
  const clickerId = record.user?.id;
  const action = record.actions?.[0];
  if (!clickerId || !action?.value || !action.action_id) return undefined;
  const [proposalId, taskGid] = action.value.split("|");
  if (!proposalId) return undefined;
  const kind = action.action_id === "status_confirm"
    ? "confirm"
    : action.action_id === "status_pick"
      ? "pick"
      : action.action_id === "status_choose"
        ? "choose"
        : action.action_id === "status_dismiss"
          ? "dismiss"
          : undefined;
  if (!kind) return undefined;
  return { action: kind, proposalId, taskGid, clickerId, responseUrl: record.response_url };
}

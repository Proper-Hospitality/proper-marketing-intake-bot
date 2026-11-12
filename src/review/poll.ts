import { PROJECT_GID, WORKSPACE_GID } from "../intake/catalog.js";
import { addTaskComment } from "../intake/asana.js";
import type { Store } from "../store/types.js";
import { reviewBlocks } from "./blocks.js";
import {
  readyForReview,
  reviewDmText,
  workerIsApprover,
  type ReviewParty,
  type ReviewSession,
  type ReviewTask,
} from "./loop.js";
import { loadReviewParty, loadReviewSession, saveReviewSession } from "./store.js";

const ASANA_BASE = "https://app.asana.com/api/1.0";

export async function searchOpenProjectTasks(input: {
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<ReviewTask[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    "projects.any": PROJECT_GID,
    completed: "false",
    opt_fields: "name,permalink_url,completed,assignee.name,memberships.section.name,custom_fields.name,custom_fields.display_value,custom_fields.text_value",
    limit: "50",
  });
  const response = await fetchImpl(`${ASANA_BASE}/workspaces/${WORKSPACE_GID}/tasks/search?${params.toString()}`, {
    headers: { authorization: `Bearer ${input.token}` },
  });
  if (!response.ok) return [];
  const payload = await response.json() as { data?: ReviewTask[] };
  return payload.data ?? [];
}

/**
 * The repo has no Asana webhook. Status updates today only go Slack → Asana.
 * This scan is how the bot notices a task sitting in Review with a deliverable link.
 */
export async function pollReviews(input: {
  token: string;
  store: Store;
  postDm: (userId: string, text: string, blocks: unknown[]) => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<{ opened: number }> {
  const tasks = await searchOpenProjectTasks(input);
  let opened = 0;
  for (const task of tasks) {
    const ready = readyForReview(task);
    if (!ready) continue;
    const party = await loadReviewParty(input.store, task.gid);
    if (!party?.approverSlackId) continue;
    if (workerIsApprover(party, task)) {
      await flagWorkerApprover(input, party);
      continue;
    }
    const existing = await loadReviewSession(input.store, task.gid);
    if (existing && existing.phase !== "changes_sent") continue;
    if (existing && existing.link === ready.link) continue;
    if (existing && existing.round >= 2) continue;
    const session: ReviewSession = {
      taskGid: task.gid,
      taskName: party.taskName || task.name || "Request",
      taskUrl: task.permalink_url || party.taskUrl,
      property: party.property,
      link: ready.link,
      approverName: party.approverName,
      approverSlackId: party.approverSlackId,
      workerName: task.assignee?.name || party.workerName,
      round: existing?.round ?? 0,
      phase: "awaiting_choice",
    };
    const text = reviewDmText(session);
    await input.postDm(party.approverSlackId, text, reviewBlocks(text, task.gid));
    await saveReviewSession(input.store, session);
    opened += 1;
  }
  return { opened };
}

async function flagWorkerApprover(input: {
  token: string;
  store: Store;
  fetchImpl?: typeof fetch;
}, party: ReviewParty): Promise<void> {
  const existing = await loadReviewSession(input.store, party.taskGid);
  if (existing) return;
  await addTaskComment({
    token: input.token,
    taskGid: party.taskGid,
    text: `${party.approverName} did the work, so they can't approve it. A different approver is needed.`,
    fetchImpl: input.fetchImpl,
  });
  await saveReviewSession(input.store, {
    taskGid: party.taskGid,
    taskName: party.taskName,
    taskUrl: party.taskUrl,
    property: party.property,
    link: "",
    approverName: party.approverName,
    approverSlackId: party.approverSlackId,
    workerName: party.workerName,
    round: 0,
    phase: "escalated",
  });
}

export function startReviewPoll(input: {
  token?: string;
  store: Store;
  postDm: (userId: string, text: string, blocks: unknown[]) => Promise<void>;
}): void {
  if (!input.token) return;
  const seconds = Number(process.env.REVIEW_POLL_SECONDS ?? 120);
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const run = () => {
    pollReviews({ token: input.token!, store: input.store, postDm: input.postDm }).catch((error: unknown) => {
      console.error(JSON.stringify({ msg: "review_poll_failed", error: error instanceof Error ? error.message : "unknown" }));
    });
  };
  setInterval(run, seconds * 1000);
  run();
}

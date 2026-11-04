import { addTaskComment, searchExistingTasks, userFacingAsanaError } from "../intake/asana.js";
import {
  formatPropertyQuestion,
  formatQuestions,
  formatSummary,
  formatTemplateAccepted,
  formatTemplateOffer,
} from "../intake/brief.js";
import { extractDesignCopy } from "../canva/extract-copy.js";
import { continueDesign, declineDesign, offerDesignBuild, type CanvaDesignClient } from "../canva/turn.js";
import { acceptTemplate, applyAnswers, declineTemplate, type FlowOutcome, type RecordInput } from "../intake/flow.js";
import { listMissing, mentionsActualPrice } from "../intake/missing.js";
import type { ConversationState, DesignPhoto } from "../store/types.js";
import {
  chooseAssignee,
  formatAmbiguousAssignees,
  formatSearchMessage,
  partitionForBulk,
  searchOpenTasks,
  searchWorkspaceUsers,
  stageTaskCompletion,
  type TaskSearchFilters,
} from "../tasks/complete.js";
import { assistantBlocksForReplay, isHistoryRejection, sanitizeStoredHistory } from "./history.js";
import { buildSystemPrompt } from "./prompt.js";
import { INTAKE_TOOLS } from "./tools.js";
import { formatOverdueReport, overdueCountsForNames, parseNameList } from "../tasks/overdue.js";

export interface LlmContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
  signature?: string;
  data?: string;
}

export interface Llm {
  model?: string;
  complete(args: { system: string; messages: unknown[]; tools: readonly unknown[] }): Promise<{ content: LlmContentBlock[] }>;
}

export interface AgentReply {
  text: string;
  confirm?: { version: number; kind?: "intake" | "complete" };
}

export interface DesignDeps {
  canva: CanvaDesignClient;
  uploads: DesignPhoto[];
  download: (photo: DesignPhoto) => Promise<{ name: string; bytes: Uint8Array }>;
}

type CompletionView = { kind: "confirm" | "listed" | "too_many" | "ambiguous" | "refused" | "report"; text: string };

export async function runIntakeTurn(input: {
  state: ConversationState;
  userText: string;
  slackUser: { id?: string; name?: string; email?: string };
  llm: Llm;
  asanaToken?: string;
  fetchImpl?: typeof fetch;
  today?: Date;
  design?: DesignDeps;
}): Promise<AgentReply> {
  const today = input.today ?? new Date();
  const state = input.state;
  if (input.slackUser.name && !state.draft.requesterName) state.draft.requesterName = input.slackUser.name;
  if (input.slackUser.email && !state.draft.requesterEmail) state.draft.requesterEmail = input.slackUser.email;

  let preset: FlowOutcome | undefined;
  if (input.design && (state.phase === "awaiting_design_materials" || state.phase === "design_ready")) {
    const designTurn = await continueDesign({
      state,
      userText: input.userText,
      uploads: input.design.uploads,
      canva: input.design.canva,
      download: input.design.download,
      extractCopy: (text) => extractDesignCopy({ llm: input.llm, text }),
      today,
    });
    if (designTurn.action === "reply") return remember(state, input.userText, { text: designTurn.text });
    if (designTurn.action === "decline") {
      const outcome = declineDesign(state, designTurn.reason, today);
      return remember(state, input.userText, renderReply(state, input.slackUser.id, "", outcome, today));
    }
  }
  if (state.phase === "template_offered" && looksLikeAccept(input.userText)) {
    preset = acceptTemplate(state);
  } else if (state.phase === "template_offered" && looksLikeDecline(input.userText)) {
    preset = declineTemplate(state, input.userText.trim(), today);
  }
  if (preset?.kind === "accepted_template") {
    state.messages.push({ role: "user", content: input.userText });
    const reply = renderReply(state, input.slackUser.id, "", preset, today);
    state.messages.push({ role: "assistant", content: reply.text });
    state.updatedAt = new Date().toISOString();
    return reply;
  }

  if (state.phase === "submitted" && state.taskGid && mentionsActualPrice(input.userText)) {
    return recordPriceOnTask(state, input);
  }

  state.messages = sanitizeStoredHistory(state.messages);
  const previous = state.messages[state.messages.length - 1];
  if (previous?.role === "user") previous.content = `${previous.content}\n${input.userText}`;
  else state.messages.push({ role: "user", content: input.userText });
  let messages: unknown[] = state.messages.map((turn) => ({ role: turn.role, content: turn.content }));
  let assistantText = "";
  let outcome: FlowOutcome | undefined = preset;
  let completion: CompletionView | undefined;
  let healedHistory = false;

  for (let step = 0; step < 6; step += 1) {
    let response: { content: LlmContentBlock[] };
    try {
      response = await input.llm.complete({
        system: buildSystemPrompt(state, input.slackUser),
        messages,
        tools: INTAKE_TOOLS,
      });
    } catch (error) {
      if (!healedHistory && isHistoryRejection(error)) {
        healedHistory = true;
        console.log(JSON.stringify({
          msg: "history_reset",
          key: state.key,
          error: error instanceof Error ? error.message : "unknown",
        }));
        state.messages = [{ role: "user", content: input.userText }];
        messages = [{ role: "user", content: input.userText }];
        outcome = undefined;
        completion = undefined;
        continue;
      }
      throw error;
    }
    const toolUses = response.content.filter((block) => block.type === "tool_use");
    assistantText = response.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text as string)
      .join("\n")
      .trim();
    if (toolUses.length === 0) break;
    messages.push({ role: "assistant", content: assistantBlocksForReplay(response.content) });
    const results = [];
    for (const tool of toolUses) {
      const executed = await executeTool(state, tool.name ?? "", tool.input, {
        today,
        asanaToken: input.asanaToken,
        fetchImpl: input.fetchImpl,
        slackUser: input.slackUser,
      });
      if (executed.outcome) outcome = executed.outcome;
      if (executed.completion) completion = executed.completion;
      results.push({ type: "tool_result", tool_use_id: tool.id, content: JSON.stringify(executed.payload) });
    }
    messages.push({ role: "user", content: results });
    if (outcome && outcome.kind !== "invalid") break;
    if (completion && completion.kind !== "listed") break;
  }

  if (outcome?.kind === "offer_template" && input.design) {
    const offered = await offerDesignBuild(state, outcome.match, input.design.canva);
    if (offered) return remember(state, "", { text: offered }, true);
  }

  const reply = renderReply(state, input.slackUser.id, assistantText, outcome, today, completion);
  state.messages.push({ role: "assistant", content: reply.text });
  if (state.messages.length > 40) state.messages.splice(0, state.messages.length - 40);
  state.updatedAt = new Date().toISOString();
  return reply;
}

async function executeTool(
  state: ConversationState,
  name: string,
  rawInput: unknown,
  deps: { today: Date; asanaToken?: string; fetchImpl?: typeof fetch; slackUser: { name?: string; email?: string } },
): Promise<{ payload: unknown; outcome?: FlowOutcome; completion?: CompletionView }> {
  const payload = isRecord(rawInput) ? rawInput : {};
  if (name === "accept_template") {
    const outcome = acceptTemplate(state);
    return { payload: outcome, outcome };
  }
  if (name === "decline_template") {
    const outcome = declineTemplate(state, String(payload.reason ?? ""), deps.today);
    return { payload: outcome, outcome };
  }
  if (name === "record_answers") {
    if (state.phase === "template_offered" || state.phase === "awaiting_design_materials" || state.phase === "design_ready") {
      return {
        payload: {
          ok: false,
          error: "A template is waiting on the requester. Call accept_template or decline_template. Do not keep collecting.",
        },
      };
    }
    const outcome = applyAnswers(state, toRecord(payload), deps.today);
    if (outcome.kind === "confirm" && deps.asanaToken && state.draft.requestName) {
      state.duplicates = await searchExistingTasks({
        token: deps.asanaToken,
        text: state.draft.requestName,
        fetchImpl: deps.fetchImpl,
      });
    }
    return { payload: outcome, outcome };
  }
  if (name === "search_open_tasks") {
    const completion = await runTaskSearch(state, payload, deps);
    return { payload: completion, completion };
  }
  if (name === "complete_tasks") {
    const gids = asStringArray(payload.gids);
    const staged = stageTaskCompletion(state, gids);
    if (!staged.ok) {
      const completion = { kind: "refused" as const, text: staged.message };
      return { payload: staged, completion };
    }
    state.completionRequesterName = deps.slackUser.name;
    state.completionRequesterEmail = deps.slackUser.email;
    const completion = { kind: "confirm" as const, text: formatSearchMessage(state.pendingCompletion ?? [], true) };
    return { payload: { ok: true, count: state.pendingCompletion?.length ?? 0 }, completion };
  }
  if (name === "count_overdue_tasks") {
    const completion = await runOverdueCount(payload, deps);
    return { payload: completion, completion };
  }
  return { payload: { ok: false, error: `Unknown tool ${name}` } };
}

async function runOverdueCount(
  payload: Record<string, unknown>,
  deps: { today: Date; asanaToken?: string; fetchImpl?: typeof fetch },
): Promise<CompletionView> {
  const names = parseNameList(payload.names);
  if (names.length === 0) {
    return { kind: "refused", text: "Tell me which people to count. First names are enough." };
  }
  if (!deps.asanaToken) {
    return { kind: "refused", text: "I can't reach Asana because ASANA_ACCESS_TOKEN is not set. Nothing was changed." };
  }
  try {
    const report = await overdueCountsForNames({
      names,
      includeTasks: payload.includeTasks === true,
      token: deps.asanaToken,
      now: deps.today,
      fetchImpl: deps.fetchImpl,
    });
    return { kind: "report", text: formatOverdueReport(report.today, report.results, payload.includeTasks === true) };
  } catch (error) {
    return { kind: "refused", text: `I couldn't count overdue tasks. Nothing was changed. ${userFacingAsanaError(error)}` };
  }
}

async function runTaskSearch(
  state: ConversationState,
  payload: Record<string, unknown>,
  deps: { asanaToken?: string; fetchImpl?: typeof fetch },
): Promise<CompletionView> {
  if (!deps.asanaToken) {
    return { kind: "refused", text: "I can't reach Asana because ASANA_ACCESS_TOKEN is not set. Nothing was changed." };
  }
  const filters: TaskSearchFilters = {
    assigneeName: asString(payload.assigneeName),
    text: asString(payload.text),
    projectName: asString(payload.projectName),
    dueOn: asString(payload.dueOn),
    dueBefore: asString(payload.dueBefore),
    dueAfter: asString(payload.dueAfter),
  };
  try {
    let assigneeGid: string | undefined;
    if (filters.assigneeName) {
      const people = await searchWorkspaceUsers({ token: deps.asanaToken, query: filters.assigneeName, fetchImpl: deps.fetchImpl });
      const choice = chooseAssignee(filters.assigneeName, people);
      if (choice.status === "none" || choice.status === "skipped") {
        return { kind: "refused", text: `I didn't find an Asana user named "${filters.assigneeName}".` };
      }
      if (choice.status === "ambiguous") {
        return { kind: "ambiguous", text: formatAmbiguousAssignees(filters.assigneeName, choice.users) };
      }
      assigneeGid = choice.user.gid;
    }
    const tasks = await searchOpenTasks({ token: deps.asanaToken, assigneeGid, filters, fetchImpl: deps.fetchImpl });
    state.lastTaskSearch = tasks;
    const text = formatSearchMessage(tasks, false);
    return partitionForBulk(tasks).status === "too_many" ? { kind: "too_many", text } : { kind: "listed", text };
  } catch (error) {
    return { kind: "refused", text: `I couldn't search Asana. Nothing was changed. ${userFacingAsanaError(error)}` };
  }
}

function renderReply(
  state: ConversationState,
  userId: string | undefined,
  assistantText: string,
  outcome: FlowOutcome | undefined,
  today: Date,
  completion?: CompletionView,
): AgentReply {
  if (completion?.kind === "confirm") {
    return { text: completion.text, confirm: { version: state.confirmVersion, kind: "complete" } };
  }
  if (completion) return { text: completion.text };
  if (outcome?.kind === "accepted_template") {
    return { text: formatTemplateAccepted(outcome.match) };
  }
  if (outcome?.kind === "offer_template" || (state.phase === "template_offered" && state.templateOffer && outcome)) {
    const match = outcome?.kind === "offer_template" ? outcome.match : state.templateOffer;
    if (match) return { text: formatTemplateOffer(match) };
  }
  if (outcome?.kind === "need_property") {
    return { text: formatPropertyQuestion(userId) };
  }
  if (outcome?.kind === "ask") {
    return {
      text: formatQuestions({
        userId,
        items: outcome.missing.items,
        warnings: outcome.missing.warnings,
        draft: state.draft,
      }),
    };
  }
  if (outcome?.kind === "confirm" || state.phase === "awaiting_confirm") {
    const missing = outcome?.kind === "confirm" ? outcome.missing : listMissing(state.draft, today);
    return {
      text: formatSummary({
        draft: state.draft,
        warnings: missing.warnings,
        templateOffer: state.templateOffer,
        duplicates: state.duplicates,
      }),
      confirm: { version: state.confirmVersion },
    };
  }
  if (assistantText) return { text: assistantText };
  return {
    text: "Tell me what you need from the marketing team, or ask how intake works. Nothing is filed without a confirmation button.",
  };
}

async function recordPriceOnTask(
  state: ConversationState,
  input: {
    userText: string;
    slackUser: { name?: string; email?: string };
    asanaToken?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<AgentReply> {
  state.messages = sanitizeStoredHistory(state.messages);
  state.messages.push({ role: "user", content: input.userText });
  const who = [input.slackUser.name?.trim(), input.slackUser.email?.trim()].filter(Boolean).join(", ");
  const comment = who ? `Price from Slack (${who}): ${input.userText.trim()}` : `Price from Slack: ${input.userText.trim()}`;
  let text: string;
  if (!input.asanaToken) {
    text = "I couldn't add that price to the Asana task because ASANA_ACCESS_TOKEN is not set.";
  } else {
    try {
      await addTaskComment({
        token: input.asanaToken,
        taskGid: state.taskGid as string,
        text: comment,
        fetchImpl: input.fetchImpl,
      });
      state.draft.pricePending = false;
      text = `I added that price to the Asana task${state.taskUrl ? `: ${state.taskUrl}` : ""}.`;
    } catch (error) {
      text = `I couldn't add that price to the Asana task. ${userFacingAsanaError(error)}`;
    }
  }
  state.messages.push({ role: "assistant", content: text });
  state.updatedAt = new Date().toISOString();
  return { text };
}

function remember(state: ConversationState, userText: string, reply: AgentReply, userAlreadyStored = false): AgentReply {
  if (!userAlreadyStored) state.messages.push({ role: "user", content: userText });
  state.messages.push({ role: "assistant", content: reply.text });
  if (state.messages.length > 40) state.messages.splice(0, state.messages.length - 40);
  state.updatedAt = new Date().toISOString();
  return reply;
}

function looksLikeAccept(text: string): boolean {
  const trimmed = text.trim();
  return /^(yes|yep|yeah|sure|ok|okay|sounds good|perfect|that works)[.!]?\s*$/i.test(trimmed)
    || /\b(i'?ll|we'?ll|i will|we will)\b[^.]*\b(template|myself|ourselves)\b/i.test(trimmed)
    || /\buse the template\b/i.test(trimmed);
}

function looksLikeDecline(text: string): boolean {
  return /^(no|nope|nah)[.!]?\s*$/i.test(text.trim())
    || /doesn'?t (fit|work)|don'?t like|do not like|team (should |to )?design|design it|not the right template|skip the template|full (brief|submission)|rather the team/i.test(text);
}

function toRecord(payload: Record<string, unknown>): RecordInput {
  const followUps = isRecord(payload.followUps)
    ? Object.fromEntries(Object.entries(payload.followUps).map(([key, value]) => [key, String(value)]))
    : undefined;
  return {
    requesterName: asString(payload.requesterName),
    requesterEmail: asString(payload.requesterEmail),
    requestName: asString(payload.requestName),
    properties: asStringArray(payload.properties),
    requestedCompletionDate: asString(payload.requestedCompletionDate),
    consequenceOfDelay: asString(payload.consequenceOfDelay),
    requestType: asString(payload.requestType),
    taskType: asString(payload.taskType),
    followUps,
    approver: asString(payload.approver),
    whereItGoesLive: asString(payload.whereItGoesLive),
    finalCopy: asString(payload.finalCopy),
    copyOwner: asString(payload.copyOwner),
    copyDueDate: asString(payload.copyDueDate),
    assets: asStringArray(payload.assets),
    assetsOwner: asString(payload.assetsOwner),
    assetsDue: asString(payload.assetsDue),
    notes: asString(payload.notes),
    filingOnBehalf: typeof payload.filingOnBehalf === "boolean" ? payload.filingOnBehalf : undefined,
    pricePending: typeof payload.pricePending === "boolean" ? payload.pricePending : undefined,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

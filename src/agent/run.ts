import { searchExistingTasks } from "../intake/asana.js";
import {
  formatPropertyQuestion,
  formatQuestions,
  formatSummary,
  formatTemplateAccepted,
  formatTemplateOffer,
} from "../intake/brief.js";
import { acceptTemplate, applyAnswers, declineTemplate, type FlowOutcome, type RecordInput } from "../intake/flow.js";
import { listMissing } from "../intake/missing.js";
import type { ConversationState } from "../store/types.js";
import { buildSystemPrompt } from "./prompt.js";
import { INTAKE_TOOLS } from "./tools.js";

export interface LlmContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface Llm {
  model?: string;
  complete(args: { system: string; messages: unknown[]; tools: readonly unknown[] }): Promise<{ content: LlmContentBlock[] }>;
}

export interface AgentReply {
  text: string;
  confirm?: { version: number };
}

export async function runIntakeTurn(input: {
  state: ConversationState;
  userText: string;
  slackUser: { id?: string; name?: string; email?: string };
  llm: Llm;
  asanaToken?: string;
  fetchImpl?: typeof fetch;
  today?: Date;
}): Promise<AgentReply> {
  const today = input.today ?? new Date();
  const state = input.state;
  if (input.slackUser.name && !state.draft.requesterName) state.draft.requesterName = input.slackUser.name;
  if (input.slackUser.email && !state.draft.requesterEmail) state.draft.requesterEmail = input.slackUser.email;

  let preset: FlowOutcome | undefined;
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

  state.messages.push({ role: "user", content: input.userText });
  const messages: unknown[] = state.messages.map((turn) => ({ role: turn.role, content: turn.content }));
  let assistantText = "";
  let outcome: FlowOutcome | undefined = preset;

  for (let step = 0; step < 6; step += 1) {
    const response = await input.llm.complete({
      system: buildSystemPrompt(state, input.slackUser),
      messages,
      tools: INTAKE_TOOLS,
    });
    const toolUses = response.content.filter((block) => block.type === "tool_use");
    assistantText = response.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text as string)
      .join("\n")
      .trim();
    if (toolUses.length === 0) break;
    messages.push({ role: "assistant", content: response.content });
    const results = [];
    for (const tool of toolUses) {
      const executed = await executeTool(state, tool.name ?? "", tool.input, {
        today,
        asanaToken: input.asanaToken,
        fetchImpl: input.fetchImpl,
      });
      if (executed.outcome) outcome = executed.outcome;
      results.push({ type: "tool_result", tool_use_id: tool.id, content: JSON.stringify(executed.payload) });
    }
    messages.push({ role: "user", content: results });
    if (outcome && outcome.kind !== "invalid") break;
  }

  const reply = renderReply(state, input.slackUser.id, assistantText, outcome, today);
  state.messages.push({ role: "assistant", content: reply.text });
  if (state.messages.length > 40) state.messages.splice(0, state.messages.length - 40);
  state.updatedAt = new Date().toISOString();
  return reply;
}

async function executeTool(
  state: ConversationState,
  name: string,
  rawInput: unknown,
  deps: { today: Date; asanaToken?: string; fetchImpl?: typeof fetch },
): Promise<{ payload: unknown; outcome?: FlowOutcome }> {
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
    if (state.phase === "template_offered") {
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
  return { payload: { ok: false, error: `Unknown tool ${name}` } };
}

function renderReply(
  state: ConversationState,
  userId: string | undefined,
  assistantText: string,
  outcome: FlowOutcome | undefined,
  today: Date,
): AgentReply {
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

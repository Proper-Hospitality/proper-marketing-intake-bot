import {
  applyAttachmentAnswer,
  captureIncomingFiles,
  isAttachmentQuestion,
  uploadReadyPdfPrompt,
  viewAttachments,
  type AttachmentInput,
} from "../intake/attachments.js";
import { addTaskComment, searchExistingTasks, userFacingAsanaError } from "../intake/asana.js";
import { absorbTurnFacts, contradictsCaptured, noteResolvedDate, type TurnAttachment } from "../intake/capture.js";
import { replyToFiledThread } from "../intake/filed-reply.js";
import { formatSpokenDate, resolveDateInput } from "../intake/relative-date.js";
import {
  formatPropertyQuestion,
  formatQuestions,
  formatSummary,
  formatTemplateAccepted,
  formatTemplateOffer,
} from "../intake/brief.js";
import { extractDesignCopy } from "../canva/extract-copy.js";
import { continueDesign, declineDesign, offerDesignBuild, type CanvaDesignClient } from "../canva/turn.js";
import { isBackAnswer, isSkipAnswer, rewindLastAnswer, skipAsked } from "../intake/conversation.js";
import {
  dateStillNeeded,
  isDateQuestion,
  isUnsureAnswer,
  nudgeToFindAnswer,
  offerMarketingRecommend,
  recordMarketingRecommend,
  stillCantGetIt,
  wantsMarketingRecommend,
} from "../intake/recommend.js";
import { DELIVERABLE_QUESTION, parseDeliverableChoice } from "../intake/routing.js";
import { rushAllowsApproval, rushExplanation } from "../intake/rush.js";
import { COLLATERAL_YEAR_QUESTION, formatCollateralOffer } from "../intake/collateral/format.js";
import { yearInText } from "../intake/collateral/match.js";
import {
  acceptCollateral,
  acceptTemplate,
  applyAnswers,
  declineCollateral,
  declineTemplate,
  type FlowOutcome,
  type RecordInput,
} from "../intake/flow.js";
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
import { LEADING_ACK, naturalAck } from "../intake/ask-text.js";
import { emailAddressee, formatEmailPropertyConfirm } from "../intake/email/present.js";
import { interpretPropertyConfirm, userCorrectsEmailRequester, userCorrectsEmailType } from "../intake/email/parse.js";
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
  attachments?: TurnAttachment[];
  readAttachment?: (file: TurnAttachment) => Promise<string | undefined>;
  slackToken?: string;
  rush?: {
    store: import("../store/types.js").Store;
    channel: string;
    threadTs?: string;
    postDm: (userId: string, text: string, blocks: import("@slack/types").KnownBlock[]) => Promise<void>;
  };
}): Promise<AgentReply> {
  const today = input.today ?? new Date();
  const state = input.state;
  if (input.slackUser.name && !state.draft.requesterName) state.draft.requesterName = input.slackUser.name;
  if (input.slackUser.email && !state.draft.requesterEmail) state.draft.requesterEmail = input.slackUser.email;
  captureIncomingFiles(state.draft, input.userText, state.lastAskedId);

  let preset: FlowOutcome | undefined;
  if (state.lastAskedId && (state.phase === "collecting" || state.phase === "awaiting_confirm")) {
    if (isBackAnswer(input.userText) && rewindLastAnswer(state)) {
      const outcome = applyAnswers(state, {}, today);
      const reply = renderReply(state, input.slackUser, "Let's change that.", outcome, today);
      reply.text = `Let's change that.\n\n${reply.text.replace(LEADING_ACK, "")}`;
      return remember(state, input.userText, reply);
    }
    if ((isUnsureAnswer(input.userText) || stillCantGetIt(input.userText)) && state.lastAskedId && state.lastAskedLabel) {
      const id = state.lastAskedId;
      const nudges = { ...(state.unsureNudges ?? {}) };
      nudges[id] = (nudges[id] ?? 0) + 1;
      state.unsureNudges = nudges;
      const text = nudges[id] === 1
        ? nudgeToFindAnswer(state.lastAskedLabel)
        : isDateQuestion(id)
          ? dateStillNeeded(state.lastAskedLabel)
          : offerMarketingRecommend(state.lastAskedLabel);
      return remember(state, input.userText, { text });
    }
    if (wantsMarketingRecommend(input.userText) && recordMarketingRecommend(state)) {
      const outcome = applyAnswers(state, {}, today);
      return remember(state, input.userText, renderReply(state, input.slackUser, "", outcome, today));
    }
    if (isSkipAnswer(input.userText) && skipAsked(state)) {
      if (state.emailIntake && state.lastAskedId === "properties") state.emailIntake.propertyConfirmed = true;
      if (state.lastAskedId === "collateralYear") state.draft.collateralYearUnspecified = true;
      const outcome = applyAnswers(state, {}, today);
      return remember(state, input.userText, renderReply(state, input.slackUser, "", outcome, today));
    }
    if (isAttachmentQuestion(state.lastAskedId)) {
      const result = applyAttachmentAnswer(state.draft, state.lastAskedId, input.userText);
      if (result === "recorded") {
        const outcome = applyAnswers(state, {}, today);
        return remember(state, input.userText, renderReply(state, input.slackUser, "", outcome, today));
      }
      if (result === "need_pdf") {
        const index = Number(state.lastAskedId.slice("attachmentPdf:".length));
        const attachment = viewAttachments(state.draft)[index];
        const prompt = attachment
          ? uploadReadyPdfPrompt(state.draft, attachment)
          : "Send an upload-ready PDF, one menu per file. Figma Buzz files can't be used by the dev team.";
        return remember(state, input.userText, {
          text: `${prompt}\n\nThat file still isn't an upload-ready PDF the dev team can post. Export one PDF per menu, or reply *Let marketing recommend* if you can't.`,
        });
      }
    }
  }
  if (state.phase === "collateral_offered") {
    const outcome = looksLikeUseExisting(input.userText)
      ? acceptCollateral(state)
      : declineCollateral(state, input.userText, today);
    return remember(state, input.userText, renderReply(state, input.slackUser, "", outcome, today));
  }
  if (state.lastAskedId === "deliverable" && state.phase === "collecting") {
    const choice = parseDeliverableChoice(input.userText);
    if (choice) {
      state.draft.deliverableIntent = choice;
      preset = applyAnswers(state, {}, today);
    }
  }
  if (state.lastAskedId === "collateralYear" && state.phase === "collecting") {
    const year = yearInText(input.userText);
    if (year) {
      state.draft.collateralYear = year;
      preset = applyAnswers(state, {}, today);
    }
  }
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
      return remember(state, input.userText, renderReply(state, input.slackUser, "", outcome, today));
    }
  }
  if (/^request approval[.!]?$/i.test(input.userText.trim()) && state.draft.rushBlock && state.draft.requestedCompletionDate && input.rush) {
    if (!rushAllowsApproval(state.draft.rushBlock)) {
      return remember(state, input.userText, {
        text: rushExplanation(state.draft.rushBlock, state.draft.requestedCompletionDate),
      });
    }
    const { startRushApproval } = await import("../intake/rush-approval.js");
    await startRushApproval({
      state,
      store: input.rush.store,
      date: state.draft.requestedCompletionDate,
      reason: state.draft.rushBlock,
      summary: `${state.draft.requesterName ?? "Someone"} needs ${state.draft.requestName ?? "a request"} for ${(state.draft.properties ?? []).join(", ")} by ${state.draft.requestedCompletionDate}.`,
      channel: input.rush.channel,
      threadTs: input.rush.threadTs,
      postDm: input.rush.postDm,
    });
    await input.rush.store.saveConversation(state);
    return remember(state, input.userText, {
      text: "I asked Koral Captain and DeeDee Brown to approve this date. Nothing is filed until one of them approves.",
    });
  }
  if (state.phase === "template_offered" && looksLikeAccept(input.userText)) {
    preset = acceptTemplate(state);
  } else if (state.phase === "template_offered" && looksLikeDecline(input.userText)) {
    preset = declineTemplate(state, input.userText.trim(), today);
  }
  if (preset?.kind === "accepted_template") {
    state.messages.push({ role: "user", content: input.userText });
    const reply = renderReply(state, input.slackUser, "", preset, today);
    state.messages.push({ role: "assistant", content: reply.text });
    state.updatedAt = new Date().toISOString();
    return reply;
  }

  if (state.phase === "submitted" && state.taskGid && mentionsActualPrice(input.userText)) {
    return recordPriceOnTask(state, input);
  }
  if (state.phase === "submitted" && state.taskUrl) {
    const text = await replyToFiledThread({
      state,
      userText: input.userText,
      attachments: input.attachments,
      slackToken: input.slackToken,
      asanaToken: input.asanaToken,
      fetchImpl: input.fetchImpl,
    });
    return remember(state, input.userText, { text });
  }

  const specsByFileId: Record<string, string> = {};
  for (const file of input.attachments ?? []) {
    if (!input.readAttachment) break;
    try {
      const specs = await input.readAttachment(file);
      if (specs?.trim()) specsByFileId[file.slackFileId] = specs.trim();
    } catch (error) {
      console.error(JSON.stringify({
        msg: "attachment_read_failed",
        fileId: file.slackFileId,
        error: error instanceof Error ? error.message : "unknown",
      }));
    }
  }
  absorbTurnFacts({
    state,
    userText: input.userText,
    today,
    expectingDate: isDateQuestion(state.lastAskedId ?? ""),
    attachments: input.attachments,
    specsByFileId,
  });
  if (
    isDateAffirmation(input.userText)
    && state.dateConfirmFor
    && state.dateConfirmFor === state.draft.requestedCompletionDate
    && ["timing", "requestedCompletionDate", "consequenceOfDelay"].includes(state.lastAskedId ?? "")
  ) {
    state.dateConfirmShown = true;
    const outcome = applyAnswers(state, {}, today);
    const spoken = formatSpokenDate(state.dateConfirmFor);
    const reply = presentDateConfirm(state, renderReply(state, input.slackUser, "", outcome, today));
    reply.text = `Perfect, ${spoken}.\n\n${reply.text.replace(LEADING_ACK, "")}`;
    return remember(state, input.userText, reply);
  }
  if (awaitingPropertyConfirm(state)) {
    const decision = interpretPropertyConfirm(input.userText, state.emailIntake?.inferredProperties ?? []);
    if (decision !== "unclear" && state.emailIntake) {
      state.emailIntake.propertyConfirmed = true;
      const properties = decision === "accept"
        ? state.emailIntake.inferredProperties
        : decision === "decline"
          ? undefined
          : decision.properties;
      if (decision === "decline") state.emailIntake.inferredProperties = [];
      if (properties && properties.length > 0) state.emailIntake.confirmedProperties = [...properties];
      const outcome = applyAnswers(state, properties && properties.length > 0 ? { properties } : {}, today);
      return remember(state, input.userText, renderReply(state, input.slackUser, "", outcome, today));
    }
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
        system: buildSystemPrompt(state, input.slackUser, today),
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
        userText: input.userText,
      });
      if (executed.outcome) outcome = executed.outcome;
      if (executed.completion) completion = executed.completion;
      results.push({ type: "tool_result", tool_use_id: tool.id, content: JSON.stringify(executed.payload) });
    }
    messages.push({ role: "user", content: results });
    if (outcome && outcome.kind !== "invalid") break;
    if (completion && completion.kind !== "listed") break;
  }

  if (outcome?.kind === "invalid" && state.draft.requestedCompletionDate && outcome.errors.every((error) => /completion date/i.test(error))) {
    outcome = applyAnswers(state, {}, today);
  }
  if (
    (!outcome || outcome.kind === "invalid")
    && state.draft.rushBlock
    && state.draft.requestedCompletionDate
    && state.rushExplainedFor !== state.draft.requestedCompletionDate
  ) {
    outcome = applyAnswers(state, {}, today);
    assistantText = "";
  }
  let attachmentNote = "";
  if ((!outcome || outcome.kind === "invalid") && contradictsCaptured(assistantText, state, today)) {
    if ((state.draft.attachments?.length ?? 0) > 0 && /attachment/i.test(assistantText)) {
      const names = state.draft.attachments?.map((file) => file.name || file.fileName || file.ref || "file").join(", ");
      attachmentNote = `I have ${names}. I'll put ${state.draft.attachments?.length === 1 ? "it" : "them"} on the Asana task when this is filed.`;
    }
    outcome = applyAnswers(state, {}, today);
    assistantText = "";
  }
  if (!outcome && state.phase === "awaiting_confirm") {
    const missingNow = listMissing(state.draft, today);
    if (missingNow.items.length > 0) {
      state.phase = "collecting";
      outcome = { kind: "ask", missing: missingNow };
    }
  }

  if (outcome?.kind === "offer_template" && input.design) {
    const offered = await offerDesignBuild(state, outcome.match, input.design.canva);
    if (offered) {
      const reply = presentDateConfirm(state, { text: attachmentNote ? `${attachmentNote}\n\n${offered}` : offered });
      return remember(state, "", reply, true);
    }
  }

  const reply = presentDateConfirm(state, renderReply(state, input.slackUser, assistantText, outcome, today, completion));
  if (attachmentNote) reply.text = `${attachmentNote}\n\n${reply.text}`;
  state.messages.push({ role: "assistant", content: reply.text });
  if (state.messages.length > 40) state.messages.splice(0, state.messages.length - 40);
  state.updatedAt = new Date().toISOString();
  return reply;
}

async function executeTool(
  state: ConversationState,
  name: string,
  rawInput: unknown,
  deps: { today: Date; asanaToken?: string; fetchImpl?: typeof fetch; slackUser: { name?: string; email?: string }; userText?: string },
): Promise<{ payload: unknown; outcome?: FlowOutcome; completion?: CompletionView }> {
  const payload = isRecord(rawInput) ? rawInput : {};
  if (name === "record_answers" && state.emailIntake) {
    const said = deps.userText ?? "";
    if (!userCorrectsEmailRequester(said)) {
      delete payload.requesterName;
      delete payload.requesterEmail;
    }
    if (state.draft.requestType && !userCorrectsEmailType(said)) {
      delete payload.requestType;
      delete payload.taskType;
    }
  }
  if (name === "accept_template") {
    const outcome = acceptTemplate(state);
    return { payload: outcome, outcome };
  }
  if (name === "decline_template") {
    const outcome = declineTemplate(state, String(payload.reason ?? ""), deps.today);
    return { payload: outcome, outcome };
  }
  if (name === "record_answers") {
    if (
      state.phase === "template_offered" ||
      state.phase === "collateral_offered" ||
      state.phase === "awaiting_design_materials" ||
      state.phase === "design_ready"
    ) {
      return {
        payload: {
          ok: false,
          error: "A template is waiting on the requester. Call accept_template or decline_template. Do not keep collecting.",
        },
      };
    }
    const rawDate = asString(payload.requestedCompletionDate);
    let outcome = applyAnswers(state, toRecord(payload), deps.today);
    if (state.emailIntake && state.draft.properties && state.draft.properties.length > 0) {
      state.emailIntake.propertyConfirmed = true;
      state.emailIntake.confirmedProperties = [...state.draft.properties];
    }
    if (rawDate) noteResolvedDate(state, resolveDateInput(rawDate, deps.today));
    if (
      outcome.kind === "invalid"
      && state.draft.requestedCompletionDate
      && outcome.errors.every((error) => /completion date/i.test(error))
    ) {
      outcome = applyAnswers(state, {}, deps.today);
    }
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
  speaker: { id?: string; name?: string } | undefined,
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
  if (outcome?.kind === "accepted_collateral") {
    return {
      text: `Use this existing collateral. Nothing was filed.\n\n${formatCollateralOffer(outcome.offer)}`,
    };
  }
  if (outcome?.kind === "offer_collateral") {
    return { text: formatCollateralOffer(outcome.offer) };
  }
  if (outcome?.kind === "ask_deliverable") {
    state.lastAskedId = "deliverable";
    state.lastAskedLabel = "Existing file or a change";
    return { text: DELIVERABLE_QUESTION };
  }
  if (outcome?.kind === "rush_required") {
    return { text: rushExplanation(outcome.reason, outcome.date) };
  }
  if (outcome?.kind === "ask_collateral_year") {
    state.answerTrail = [...(state.answerTrail ?? []), state.lastAskedId].filter((id): id is string => Boolean(id)).slice(-30);
    state.lastAskedId = "collateralYear";
    state.lastAskedLabel = "Collateral year";
    const ack = state.answerTrail && state.answerTrail.length > 0 ? "Sounds good.\n\n" : "";
    return { text: `${ack}${COLLATERAL_YEAR_QUESTION}` };
  }
  if (outcome?.kind === "offer_template" || (state.phase === "template_offered" && state.templateOffer && outcome)) {
    const match = outcome?.kind === "offer_template" ? outcome.match : state.templateOffer;
    if (match) return { text: formatTemplateOffer(match) };
  }
  const addressed = state.emailIntake ? emailAddressee(state) : { userId: speaker?.id, who: speaker?.name };
  const mentionId = addressed.userId ?? speaker?.id;
  const spokenName = addressed.who ?? speaker?.name;
  if (outcome?.kind === "need_property") {
    const confirm = formatEmailPropertyConfirm(state);
    if (confirm) {
      state.lastAskedId = "properties";
      state.lastAskedLabel = "Property";
      return { text: confirm };
    }
    return { text: formatPropertyQuestion(mentionId, spokenName) };
  }
  if (outcome?.kind === "ask") {
    const item = outcome.missing.items[0];
    const previous = state.lastAskedId;
    if (item) {
      if (previous && previous !== item.id) {
        state.answerTrail = [...(state.answerTrail ?? []), previous].slice(-30);
      }
      state.lastAskedId = item.id;
      state.lastAskedLabel = item.label;
    }
    const confirm = item?.id === "properties" ? formatEmailPropertyConfirm(state) : undefined;
    if (confirm) {
      const lead = state.answerTrail?.length ? `${naturalAck({ lastId: previous, draft: state.draft })}\n\n${confirm}` : confirm;
      return { text: outcome.preface ? `${outcome.preface}\n\n${lead}` : lead };
    }
    const captured = capturedHalf(state, item?.id);
    const emailThread = Boolean(state.emailIntake);
    const question = formatQuestions({
      userId: emailThread ? undefined : mentionId,
      who: emailThread ? undefined : spokenName,
      items: item ? [item] : [],
      warnings: item && /timing|date|late/i.test(item.id + item.label) ? outcome.missing.warnings : [],
      draft: state.draft,
      acknowledge: Boolean(state.answerTrail?.length),
      ackFor: previous,
      offerHelp: !emailThread && !state.answerTrail?.length,
      captured,
    });
    return { text: outcome.preface ? `${outcome.preface}\n\n${question}` : question };
  }
  if (outcome?.kind === "confirm" || state.phase === "awaiting_confirm") {
    const missing = outcome?.kind === "confirm" ? outcome.missing : listMissing(state.draft, today);
    const summary = formatSummary({
      draft: state.draft,
      warnings: missing.warnings,
      templateOffer: state.templateOffer,
      duplicates: state.duplicates,
    });
    const preface = outcome?.kind === "confirm" ? outcome.preface : undefined;
    return {
      text: preface ? `${preface}\n\n${summary}` : summary,
      confirm: { version: state.confirmVersion },
    };
  }
  if (state.phase === "submitted" && state.taskUrl) {
    return { text: `This is already filed: ${state.taskUrl}` };
  }
  if (assistantText) return { text: assistantText };
  return {
    text: "Tell me what you need from the marketing team, or ask how intake works. Nothing is filed without a confirmation button.",
  };
}

function awaitingPropertyConfirm(state: ConversationState): boolean {
  const email = state.emailIntake;
  return Boolean(
    email
    && !email.propertyConfirmed
    && (email.inferredProperties?.length ?? 0) > 0
    && state.lastAskedId === "properties"
    && (state.phase === "collecting" || state.phase === "awaiting_confirm"),
  );
}

function capturedHalf(state: ConversationState, itemId: string | undefined): string | undefined {
  if (itemId === "consequenceOfDelay" && state.draft.requestedCompletionDate && state.dateConfirmShown) {
    return `Due ${formatSpokenDate(state.draft.requestedCompletionDate)}.`;
  }
  if (itemId === "requestedCompletionDate" && state.draft.consequenceOfDelay && !state.draft.requestedCompletionDate) {
    return `If it's late: ${state.draft.consequenceOfDelay}`;
  }
  return undefined;
}

function presentDateConfirm(state: ConversationState, reply: AgentReply): AgentReply {
  if (!reply.text || state.phase === "submitted") return reply;
  if (!state.dateConfirmFor || state.dateConfirmShown) return reply;
  if (state.dateConfirmFor !== state.draft.requestedCompletionDate) return reply;
  state.dateConfirmShown = true;
  return { ...reply, text: `${formatSpokenDate(state.dateConfirmFor)} — right?\n\n${reply.text}` };
}

function isDateAffirmation(text: string): boolean {
  return /^(yes|yep|yeah|yup|correct|right|that'?s right|that is right)[.!]?$/i.test(text.trim());
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

function looksLikeUseExisting(text: string): boolean {
  const trimmed = text.trim();
  return /^(yes|yep|yeah|sure|ok|okay)[.!]?\s*$/i.test(trimmed)
    || /\bi'?ll use (this|it|the link|the existing)\b/i.test(trimmed)
    || /\buse (this|the link|the existing file)\b/i.test(trimmed);
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
    attachments: asAttachments(payload.attachments),
    involvesFiles: payload.involvesFiles === true ? true : undefined,
    notes: asString(payload.notes),
    filingOnBehalf: typeof payload.filingOnBehalf === "boolean" ? payload.filingOnBehalf : undefined,
    pricePending: typeof payload.pricePending === "boolean" ? payload.pricePending : undefined,
  };
}

function asAttachments(value: unknown): AttachmentInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments: AttachmentInput[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const ref = asString(item.ref) ?? asString(item.url) ?? asString(item.name);
    if (!ref?.trim()) continue;
    attachments.push({
      ref,
      kind: asString(item.kind),
      fileName: asString(item.fileName),
      uploadReady: item.uploadReady === true,
      pdfDeferred: item.pdfDeferred === true,
    });
  }
  return attachments;
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

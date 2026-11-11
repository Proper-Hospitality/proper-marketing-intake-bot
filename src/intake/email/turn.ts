import { rememberAttachment } from "../capture.js";
import { applyAnswers } from "../flow.js";
import { confirmBlocks, emailSplitBlocks, messageBlocks } from "../../slack/blocks.js";
import { messageOnceKey } from "../../slack/incoming.js";
import type { SlackApi } from "../../slack/api.js";
import { conversationKey, conversationKeyFromAction, emptyConversation, type ConversationState, type Store } from "../../store/types.js";
import { formatParty, parseSplitChoice, proposeEmailBriefs } from "./parse.js";
import { formatSplitProposal, presentEmailStep, type EmailReply } from "./present.js";
import type { EmailIntakeState, EmailProposal, InboundEmail } from "./types.js";

export interface EmailTurnDeps {
  store: Store;
  slack: SlackApi;
  today?: Date;
}

export async function beginEmailIntake(deps: EmailTurnDeps, email: InboundEmail): Promise<void> {
  const claim = messageOnceKey({ channel: email.channel, ts: email.messageTs });
  const fresh = await deps.store.claimEvent(claim, 600);
  if (!fresh) return;
  try {
    const today = deps.today ?? new Date();
    const key = conversationKey(email.channel, email.messageTs, email.messageTs, false);
    const state = emptyConversation(key);
    state.channel = email.channel;
    state.threadTs = email.messageTs;
    if (email.slackUserId) state.slackUserId = email.slackUserId;
    state.emailIntake = intakeFromEmail(email);
    let reply: EmailReply;
    const first = state.emailIntake.proposals[0];
    if (state.emailIntake.proposals.length >= 2 && first) {
      state.phase = "awaiting_email_split";
      state.draft = seedDraft(state.emailIntake, first, false);
      reply = { text: formatSplitProposal(state) };
      state.messages.push({ role: "user", content: email.bodyText });
      state.messages.push({ role: "assistant", content: reply.text });
    } else {
      state.emailIntake.mode = "single";
      reply = activateProposal(state, 0, today);
    }
    state.updatedAt = new Date().toISOString();
    await deps.store.saveConversation(state);
    await deps.slack.postMessage({
      channel: email.channel,
      threadTs: email.messageTs,
      text: reply.text,
      blocks: replyBlocks(reply, state.emailIntake.proposals.length),
    });
  } catch (error) {
    await deps.store.releaseEvent(claim);
    throw error;
  }
}

export async function continueEmailConversation(
  deps: EmailTurnDeps,
  state: ConversationState,
  message: { text: string },
): Promise<boolean> {
  const email = state.emailIntake;
  if (!email || !state.channel) return false;
  const today = deps.today ?? new Date();
  if (state.phase === "awaiting_email_split") {
    const choice = parseSplitChoice(message.text);
    state.messages.push({ role: "user", content: message.text });
    if (choice === "unclear") {
      const text = "Reply *yes* to split this into separate requests, or *keep it as one* for a single task. Nothing is filed yet.";
      state.messages.push({ role: "assistant", content: text });
      state.updatedAt = new Date().toISOString();
      await deps.store.saveConversation(state);
      await deps.slack.postMessage({
        channel: state.channel,
        threadTs: state.threadTs,
        text,
        blocks: messageBlocks(text),
      });
      return true;
    }
    const reply = applyEmailChoice(state, choice, today);
    state.updatedAt = new Date().toISOString();
    await deps.store.saveConversation(state);
    await deps.slack.postMessage({
      channel: state.channel,
      threadTs: state.threadTs,
      text: reply.text,
      blocks: replyBlocks(reply),
    });
    return true;
  }
  if (state.phase === "submitted" && hasUnstartedBrief(email)) {
    const reply = startNextEmailBrief(state, today);
    if (!reply) return false;
    state.updatedAt = new Date().toISOString();
    await deps.store.saveConversation(state);
    await deps.slack.postMessage({
      channel: state.channel,
      threadTs: state.threadTs,
      text: reply.text,
      blocks: replyBlocks(reply),
    });
    return true;
  }
  return false;
}

export async function handleEmailSplitAction(deps: EmailTurnDeps, action: {
  choice: "split" | "one";
  channel: string;
  messageTs: string;
  threadTs?: string;
}): Promise<void> {
  const threadTs = action.threadTs;
  if (!threadTs) {
    const text = "I couldn't tell which email that button belongs to.";
    await deps.slack.postMessage({ channel: action.channel, text, blocks: messageBlocks(text) });
    return;
  }
  const state = await deps.store.getConversation(conversationKeyFromAction(action.channel, threadTs));
  if (!state?.emailIntake || state.phase !== "awaiting_email_split") {
    const text = "That choice was already made.";
    await deps.slack.postMessage({
      channel: action.channel,
      threadTs,
      text,
      blocks: messageBlocks(text),
    });
    return;
  }
  const reply = applyEmailChoice(state, action.choice, deps.today ?? new Date());
  state.updatedAt = new Date().toISOString();
  await deps.store.saveConversation(state);
  const label = action.choice === "split"
    ? `Splitting this into ${state.emailIntake.proposals.length} requests.`
    : "Keeping this as one request.";
  await deps.slack.updateMessage({
    channel: action.channel,
    ts: action.messageTs,
    text: label,
    blocks: messageBlocks(label),
  });
  await deps.slack.postMessage({
    channel: action.channel,
    threadTs,
    text: reply.text,
    blocks: replyBlocks(reply),
  });
}

export function applyEmailChoice(state: ConversationState, choice: "split" | "one", today: Date): EmailReply {
  const email = state.emailIntake;
  if (!email) return { text: "I lost the email for this thread." };
  if (choice === "one") {
    email.mode = "single";
    email.proposals = [mergeProposals(email)];
  } else {
    email.mode = "split";
  }
  return activateProposal(state, 0, today);
}

export function startNextEmailBrief(state: ConversationState, today = new Date()): EmailReply | undefined {
  const email = state.emailIntake;
  if (!email || email.mode !== "split") return undefined;
  noteFiled(state);
  const next = (email.activeIndex ?? 0) + 1;
  if (next >= email.proposals.length) return undefined;
  return activateProposal(state, next, today);
}

function intakeFromEmail(email: InboundEmail): EmailIntakeState {
  return {
    source: email.source,
    messageTs: email.messageTs,
    subject: email.subject,
    originalRequester: formatParty(email.originalSender),
    originalName: email.originalSender.name,
    originalEmail: email.originalSender.email,
    forwarder: formatParty(email.forwarder),
    forwarded: email.forwarded,
    bodyText: email.bodyText,
    proposals: proposeEmailBriefs({ subject: email.subject, bodyText: email.bodyText }),
    filed: [],
    files: email.files,
  };
}

function activateProposal(state: ConversationState, index: number, today: Date): EmailReply {
  const email = state.emailIntake;
  if (!email) return { text: "I lost the email for this thread." };
  const proposal = email.proposals[index];
  if (!proposal) return { text: "I lost the next request from that email." };
  resetBriefState(state);
  email.activeIndex = index;
  if (!email.mode) email.mode = email.proposals.length > 1 ? "split" : "single";
  state.draft = seedDraft(email, proposal, true);
  state.messages.push({ role: "user", content: `Brief: ${proposal.title}\n${proposal.detail}` });
  if (state.messages.length > 40) state.messages.splice(0, state.messages.length - 40);
  const outcome = applyAnswers(state, {}, today);
  const reply = presentEmailStep(state, outcome, today);
  state.messages.push({ role: "assistant", content: reply.text });
  return reply;
}

function seedDraft(email: EmailIntakeState, proposal: EmailProposal, useProposal: boolean): ConversationState["draft"] {
  const draft: ConversationState["draft"] = {
    requesterName: email.originalName || email.originalEmail,
    requesterEmail: email.originalEmail,
    originalRequester: email.originalRequester,
    forwardedBy: email.forwarded ? email.forwarder : undefined,
    emailSubject: email.subject,
    filingOnBehalf: email.forwarded,
  };
  if (useProposal) {
    draft.requestName = proposal.title;
    draft.requestType = proposal.requestType;
    draft.taskType = proposal.taskType;
    draft.followUps = proposal.followUps ? { ...proposal.followUps } : undefined;
    draft.whereItGoesLive = proposal.whereItGoesLive;
  }
  for (const file of email.files) {
    rememberAttachment(draft, {
      slackFileId: file.slackFileId,
      name: file.name,
      permalink: file.permalink,
      mimetype: file.mimetype,
    });
    const saved = draft.attachments?.find((item) => item.slackFileId === file.slackFileId);
    if (saved && !saved.kind) saved.kind = "context";
  }
  return draft;
}

function mergeProposals(email: EmailIntakeState): EmailProposal {
  const detail = email.proposals.map((proposal, index) => `${index + 1}. ${proposal.title}\n${proposal.detail}`).join("\n\n");
  const title = email.subject.replace(/^\s*(?:fw|fwd)\s*:\s*/i, "").trim() || "Forwarded email";
  return {
    title,
    detail,
    requestType: "Marketing",
    taskType: "Marketing Plan",
    followUps: { "Detailed Request": detail },
  };
}

function resetBriefState(state: ConversationState): void {
  state.templateOffer = null;
  state.templateDeclinedReason = undefined;
  state.templateDeclinedFor = undefined;
  state.collateralOffer = null;
  state.collateralDeclinedFor = undefined;
  state.collateralOfferedFor = undefined;
  state.collateralSourceFor = undefined;
  state.rushExplainedFor = undefined;
  state.unsureNudges = undefined;
  state.confirmVersion = 0;
  state.taskGid = undefined;
  state.taskUrl = undefined;
  state.fieldsApplied = 0;
  state.duplicates = [];
  state.uploadedSlackFileIds = [];
  state.lastAskedId = undefined;
  state.lastAskedLabel = undefined;
  state.answerTrail = [];
  state.dateConfirmFor = undefined;
  state.dateConfirmShown = false;
  state.design = undefined;
  state.pendingCompletion = undefined;
  state.phase = "collecting";
}

function noteFiled(state: ConversationState): void {
  const email = state.emailIntake;
  if (!email || !state.taskGid) return;
  if (email.filed.some((item) => item.gid === state.taskGid)) return;
  email.filed.push({
    name: state.draft.requestName || "Request",
    url: state.taskUrl,
    gid: state.taskGid,
  });
}

function hasUnstartedBrief(email: EmailIntakeState): boolean {
  if (email.mode !== "split") return false;
  return (email.activeIndex ?? 0) + 1 < email.proposals.length;
}

function replyBlocks(reply: EmailReply, proposalCount?: number): unknown[] {
  if (reply.confirm) return confirmBlocks(reply.text, reply.confirm.version);
  if (proposalCount && proposalCount >= 2 && /reply \*yes\* to split/i.test(reply.text)) {
    return emailSplitBlocks(reply.text, proposalCount);
  }
  return messageBlocks(reply.text);
}

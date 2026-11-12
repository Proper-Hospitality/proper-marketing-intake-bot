import { FORM_URL } from "../intake/catalog.js";
import { rememberAttachment } from "../intake/capture.js";
import { continueEmailConversation, startNextEmailBrief } from "../intake/email/turn.js";
import { runIntakeTurn, type DesignDeps, type Llm } from "../agent/run.js";
import { confirmBlocks, confirmTaskCompletionBlocks, messageBlocks } from "./blocks.js";
import { slackThreadUrl } from "../intake/brief.js";
import { submitConfirmedBrief } from "./submit.js";
import { finishConfirmedCompletion } from "../tasks/complete.js";
import type { SlackApi } from "./api.js";
import { messageClaimKey, messageOnceKey } from "./incoming.js";
import { collectThreadFiles, mergeThreadFiles } from "./thread-files.js";
import { conversationKey, conversationKeyFromAction, emptyConversation, type Store } from "../store/types.js";
import { handleReviewMessage } from "../review/turn.js";

export interface IncomingMessage {
  channel: string;
  userId: string;
  text: string;
  ts: string;
  threadTs?: string;
  isDm: boolean;
  files?: string[];
  uploads?: DesignDeps["uploads"];
  edited?: boolean;
}

export async function handleIncomingMessage(deps: {
  store: Store;
  slack: SlackApi;
  llm: Llm;
  asanaToken?: string;
  fetchImpl?: typeof fetch;
  today?: Date;
  design?: Omit<DesignDeps, "uploads">;
  slackToken?: string;
  readAttachment?: (file: { slackFileId: string; name?: string; permalink?: string; mimetype?: string }) => Promise<string | undefined>;
}, message: IncomingMessage): Promise<void> {
  if (!message.edited) {
    const once = await deps.store.claimEvent(messageOnceKey(message), 600);
    if (!once) return;
  }
  const messageClaim = messageClaimKey({
    channel: message.channel,
    ts: message.ts,
    text: message.text,
    uploads: message.uploads ?? [],
  });
  const fresh = await deps.store.claimEvent(messageClaim, 600);
  if (!fresh) return;
  try {
    if (message.isDm && deps.asanaToken) {
      const reviewed = await handleReviewMessage({
        store: deps.store,
        userId: message.userId,
        text: message.text,
        asanaToken: deps.asanaToken,
        fetchImpl: deps.fetchImpl,
        today: deps.today,
        postDm: async (userId, text) => {
          if (!deps.slack.postDm) return;
          await deps.slack.postDm({ userId, text });
        },
      });
      if (reviewed) return;
    }
    await handleFreshMessage(deps, message);
  } catch (error) {
    await deps.store.releaseEvent(messageClaim);
    throw error;
  }
}

async function handleFreshMessage(deps: {
  store: Store;
  slack: SlackApi;
  llm: Llm;
  asanaToken?: string;
  fetchImpl?: typeof fetch;
  today?: Date;
  design?: Omit<DesignDeps, "uploads">;
  slackToken?: string;
  readAttachment?: (file: { slackFileId: string; name?: string; permalink?: string; mimetype?: string }) => Promise<string | undefined>;
}, message: IncomingMessage): Promise<void> {
  const key = conversationKey(message.channel, message.threadTs, message.ts, message.isDm);
  const state = (await deps.store.getConversation(key)) ?? emptyConversation(key);
  state.channel = message.channel;
  if (state.emailIntake?.requesterSlackId) state.slackUserId = state.emailIntake.requesterSlackId;
  else if (!state.emailIntake) state.slackUserId = message.userId;
  state.threadTs = message.threadTs ?? (message.isDm ? undefined : message.ts);
  const threadAnchor = state.threadTs;
  if (await continueEmailConversation({ store: deps.store, slack: deps.slack, today: deps.today }, state, message)) {
    return;
  }

  if (state.messages.length === 0 && message.threadTs) {
    const replies = await deps.slack.threadReplies(message.channel, message.threadTs);
    const prior = replies
      .filter((reply) => !reply.botId && reply.text && reply.user)
      .map((reply) => `${reply.user === message.userId ? "Requester" : reply.user}: ${reply.text}`)
      .join("\n");
    if (prior) {
      state.messages.push({
        role: "user",
        content: `Earlier messages in this thread:\n${prior}`,
      });
    }
  }

  const profile = await deps.slack.userProfile(message.userId);
  const email = state.emailIntake;
  const slackUser = email
    ? {
      id: email.requesterSlackId,
      name: email.originalName,
      email: email.originalEmail,
    }
    : { id: message.userId, name: profile.name, email: profile.email };
  const parentTs = message.threadTs && message.threadTs !== message.ts ? message.threadTs : (state.threadTs || message.ts);
  const fromThread = await collectThreadFiles(deps.slack, message.channel, parentTs, message.ts);
  const currentFiles = (message.uploads ?? []).flatMap((file) => (
    file.slackFileId ? [{
      slackFileId: file.slackFileId,
      name: file.name,
      permalink: file.permalink,
      mimetype: file.mimetype,
    }] : []
  ));
  const attachments = mergeThreadFiles(fromThread, currentFiles);
  const fileNote = attachments.length > 0
    ? `\nFiles attached (saved on this request): ${attachments.map((file) => file.permalink ? `${file.name ?? file.slackFileId} ${file.permalink}` : (file.name ?? file.slackFileId)).join(", ")}`
    : "";
  const reply = await runIntakeTurn({
    state,
    userText: `${message.text}${fileNote}`.trim(),
    slackUser,
    llm: deps.llm,
    asanaToken: deps.asanaToken,
    fetchImpl: deps.fetchImpl,
    today: deps.today,
    design: deps.design ? { ...deps.design, uploads: message.uploads ?? [] } : undefined,
    attachments,
    readAttachment: deps.readAttachment,
    slackToken: deps.slackToken,
    findSlackUser: deps.slack.findUserByName
      ? (name) => deps.slack.findUserByName!(name)
      : undefined,
    rush: {
      store: deps.store,
      channel: message.channel,
      threadTs: threadAnchor,
      postDm: async (userId, text, blocks) => {
        if (!deps.slack.postDm) throw new Error("This Slack client cannot send a direct message.");
        await deps.slack.postDm({ userId, text, blocks });
      },
    },
  });
  await deps.store.saveConversation(state);
  if (reply.silent) return;
  await deps.slack.postMessage({
    channel: message.channel,
    threadTs: threadAnchor,
    text: reply.text,
    blocks: reply.confirm
      ? reply.confirm.kind === "complete"
        ? confirmTaskCompletionBlocks(reply.text, reply.confirm.version)
        : confirmBlocks(reply.text, reply.confirm.version)
      : reply.blocks ?? messageBlocks(reply.text),
  });
}

export async function handleConfirmAction(deps: {
  store: Store;
  slack: SlackApi;
  asanaToken?: string;
  fetchImpl?: typeof fetch;
  slackToken?: string;
}, action: {
  version: number;
  channel: string;
  messageTs: string;
  threadTs?: string;
}): Promise<void> {
  const key = conversationKeyFromAction(action.channel, action.threadTs);
  const lockId = `confirm:${key}:${action.version}`;
  const claimed = await deps.store.claimEvent(lockId, 120);
  if (!claimed) {
    await deps.slack.postMessage({
      channel: action.channel,
      threadTs: action.threadTs,
      text: "I'm already filing that brief.",
      blocks: messageBlocks("I'm already filing that brief."),
    });
    return;
  }
  try {
    const state = await deps.store.getConversation(key);
    if (!state) {
      await deps.slack.postMessage({
        channel: action.channel,
        threadTs: action.threadTs,
        text: "I lost the brief for this thread. Send the request once more and I'll start again.",
        blocks: messageBlocks("I lost the brief for this thread. Send the request once more and I'll start again."),
      });
      return;
    }
    if (!deps.asanaToken) {
      await deps.slack.postMessage({
        channel: action.channel,
        threadTs: action.threadTs,
        text: `I can't reach Asana because ASANA_ACCESS_TOKEN is not set. Nothing was created. Form: ${FORM_URL}`,
        blocks: messageBlocks(`I can't reach Asana because ASANA_ACCESS_TOKEN is not set. Nothing was created. Form: ${FORM_URL}`),
      });
      return;
    }
    if (state.phase === "submitted" && state.taskUrl) {
      await deps.slack.postMessage({
        channel: action.channel,
        threadTs: action.threadTs,
        text: `This was already filed: ${state.taskUrl}`,
        blocks: messageBlocks(`This was already filed: ${state.taskUrl}`),
      });
      return;
    }
    if (state.confirmVersion !== action.version) {
      await deps.slack.postMessage({
        channel: action.channel,
        threadTs: action.threadTs,
        text: "That confirm button is out of date. Ask for a fresh summary and use the new Confirm button.",
        blocks: messageBlocks("That confirm button is out of date. Ask for a fresh summary and use the new Confirm button."),
      });
      return;
    }
    if (state.draft.rushBlock && state.draft.rushApprovedFor !== state.draft.requestedCompletionDate) {
      const text = "That date needs approval from DeeDee Brown or Koral Captain before I can file it. Nothing was created.";
      await deps.slack.postMessage({
        channel: action.channel,
        threadTs: action.threadTs,
        text,
        blocks: messageBlocks(text),
      });
      return;
    }
    await deps.slack.updateMessage({
      channel: action.channel,
      ts: action.messageTs,
      text: "Filing this on the New Intake Board.",
      blocks: messageBlocks("Filing this on the New Intake Board."),
    });
    const thread = action.threadTs ?? action.messageTs;
    if (state.channel && state.threadTs) {
      const files = await collectThreadFiles(deps.slack, state.channel, state.threadTs);
      for (const file of files) rememberAttachment(state.draft, file);
    }
    for (const file of state.emailIntake?.files ?? []) {
      const saved = state.draft.attachments?.find((item) => item.slackFileId === file.slackFileId);
      if (saved && !saved.kind) saved.kind = "context";
    }
    const result = await submitConfirmedBrief({
      confirmed: true,
      version: action.version,
      state,
      store: deps.store,
      token: deps.asanaToken,
      fetchImpl: deps.fetchImpl,
      slackThread: slackThreadUrl(action.channel, thread),
      slackToken: deps.slackToken,
    });
    const next = state.phase === "submitted" ? await startNextEmailBrief(deps, state) : undefined;
    if (state.emailIntake) await deps.store.saveConversation(state);
    const lastOfEmail = !next
      && state.emailIntake?.mode === "split"
      && state.emailIntake.filed.length > 1
      && state.phase === "submitted";
    const text = lastOfEmail ? `${result.text}\nThat was the last request from this email.` : result.text;
    await deps.slack.postMessage({
      channel: action.channel,
      threadTs: action.threadTs,
      text,
      blocks: messageBlocks(text),
    });
    if (next) {
      await deps.slack.postMessage({
        channel: action.channel,
        threadTs: action.threadTs,
        text: next.text,
        blocks: next.confirm ? confirmBlocks(next.text, next.confirm.version) : messageBlocks(next.text),
      });
    }
  } finally {
    await deps.store.releaseEvent(lockId);
  }
}

export async function handleConfirmTaskCompletion(deps: {
  store: Store;
  slack: SlackApi;
  asanaToken?: string;
  fetchImpl?: typeof fetch;
}, action: {
  version: number;
  channel: string;
  messageTs: string;
  threadTs?: string;
}): Promise<void> {
  const key = conversationKeyFromAction(action.channel, action.threadTs);
  const lockId = `complete:${key}:${action.version}`;
  const claimed = await deps.store.claimEvent(lockId, 120);
  if (!claimed) {
    await deps.slack.postMessage({
      channel: action.channel,
      threadTs: action.threadTs,
      text: "I'm already marking those tasks complete.",
      blocks: messageBlocks("I'm already marking those tasks complete."),
    });
    return;
  }
  try {
    const state = await deps.store.getConversation(key);
    if (!state) {
      await deps.slack.postMessage({
        channel: action.channel,
        threadTs: action.threadTs,
        text: "I lost that task list. Ask me to search again.",
        blocks: messageBlocks("I lost that task list. Ask me to search again."),
      });
      return;
    }
    if (!deps.asanaToken) {
      await deps.slack.postMessage({
        channel: action.channel,
        threadTs: action.threadTs,
        text: "I can't reach Asana because ASANA_ACCESS_TOKEN is not set. Nothing was marked complete.",
        blocks: messageBlocks("I can't reach Asana because ASANA_ACCESS_TOKEN is not set. Nothing was marked complete."),
      });
      return;
    }
    if (state.phase === "tasks_completed" && state.completionReport) {
      await deps.slack.postMessage({
        channel: action.channel,
        threadTs: action.threadTs,
        text: state.completionReport,
        blocks: messageBlocks(state.completionReport),
      });
      return;
    }
    if (state.confirmVersion !== action.version || state.phase !== "awaiting_task_completion") {
      await deps.slack.postMessage({
        channel: action.channel,
        threadTs: action.threadTs,
        text: "That confirm button is out of date. Search again and use the new Confirm button.",
        blocks: messageBlocks("That confirm button is out of date. Search again and use the new Confirm button."),
      });
      return;
    }
    await deps.slack.updateMessage({
      channel: action.channel,
      ts: action.messageTs,
      text: "Marking those tasks complete.",
      blocks: messageBlocks("Marking those tasks complete."),
    });
    const result = await finishConfirmedCompletion({
      confirmed: true,
      version: action.version,
      state,
      token: deps.asanaToken,
      fetchImpl: deps.fetchImpl,
    });
    await deps.store.saveConversation(state);
    await deps.slack.postMessage({
      channel: action.channel,
      threadTs: action.threadTs,
      text: result.text,
      blocks: messageBlocks(result.text),
    });
  } finally {
    await deps.store.releaseEvent(lockId);
  }
}

export async function handleCancelTaskCompletion(deps: { store: Store; slack: SlackApi }, action: {
  version: number;
  channel: string;
  messageTs: string;
  threadTs?: string;
}): Promise<void> {
  const key = conversationKeyFromAction(action.channel, action.threadTs);
  const state = await deps.store.getConversation(key);
  if (!state) return;
  if (state.confirmVersion !== action.version || state.phase !== "awaiting_task_completion") {
    await deps.slack.postMessage({
      channel: action.channel,
      threadTs: action.threadTs,
      text: "That list is already out of date.",
      blocks: messageBlocks("That list is already out of date."),
    });
    return;
  }
  state.phase = "collecting";
  state.pendingCompletion = undefined;
  state.confirmVersion += 1;
  state.updatedAt = new Date().toISOString();
  await deps.store.saveConversation(state);
  const text = "I won't mark those tasks complete.";
  await deps.slack.updateMessage({
    channel: action.channel,
    ts: action.messageTs,
    text,
    blocks: messageBlocks(text),
  });
}

export async function handleReviseAction(deps: { store: Store; slack: SlackApi }, action: {
  version: number;
  channel: string;
  messageTs: string;
  threadTs?: string;
}): Promise<void> {
  const key = conversationKeyFromAction(action.channel, action.threadTs);
  const state = await deps.store.getConversation(key);
  if (!state) return;
  if (state.confirmVersion !== action.version) {
    await deps.slack.postMessage({
      channel: action.channel,
      threadTs: action.threadTs,
      text: "That summary is already out of date.",
      blocks: messageBlocks("That summary is already out of date."),
    });
    return;
  }
  state.phase = "collecting";
  state.confirmVersion += 1;
  state.updatedAt = new Date().toISOString();
  await deps.store.saveConversation(state);
  const text = "What should we change? I'll show a new summary before anything is filed.";
  await deps.slack.updateMessage({
    channel: action.channel,
    ts: action.messageTs,
    text,
    blocks: messageBlocks(text),
  });
}

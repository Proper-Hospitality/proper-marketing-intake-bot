import { conversationKey, type Store } from "../store/types.js";
import { HANDLER_FAILURE_TEXT } from "./failure.js";
import { normalizeSlackMessage, shouldHandleThreadReply, type NormalizedSlackMessage, type SlackMessageShape } from "./incoming.js";

export async function dispatchUserMessage(args: {
  event: SlackMessageShape;
  store: Store;
  onMessage: (message: NormalizedSlackMessage) => Promise<void>;
  postError: (channel: string, threadTs: string | undefined, text: string) => Promise<void>;
}): Promise<"handled" | "ignored"> {
  const normalized = normalizeSlackMessage(args.event);
  if (!normalized) return "ignored";
  if (args.event.type === "app_mention") {
    normalized.text = normalized.text.replace(/<@[A-Z0-9]+>/g, "").trim();
  }
  const mentioned = args.event.type === "app_mention";
  if (!mentioned && !shouldHandleThreadReply({
    isDm: normalized.isDm,
    threadTs: normalized.threadTs,
    hasConversation: normalized.isDm ? true : await threadHasConversation(args.store, normalized),
  })) {
    console.log(JSON.stringify({
      msg: "channel_thread_ignored",
      channel: normalized.channel,
      threadTs: normalized.threadTs,
    }));
    return "ignored";
  }
  console.log(JSON.stringify({
    msg: "thread_reply_accepted",
    channel: normalized.channel,
    threadTs: normalized.threadTs,
    edited: normalized.edited,
    subtype: args.event.subtype,
    files: normalized.uploads.length,
  }));
  try {
    await args.onMessage(normalized);
    return "handled";
  } catch (error) {
    console.error(JSON.stringify({
      msg: "intake_handler_failed",
      channel: normalized.channel,
      threadTs: normalized.threadTs,
      error: error instanceof Error ? error.message : "unknown",
    }));
    try {
      await args.postError(normalized.channel, normalized.threadTs, HANDLER_FAILURE_TEXT);
    } catch (postError) {
      console.error(JSON.stringify({
        msg: "slack_error_reply_failed",
        error: postError instanceof Error ? postError.message : "unknown",
      }));
      throw error;
    }
    return "handled";
  }
}

async function threadHasConversation(store: Store, message: { channel: string; threadTs?: string; ts: string }): Promise<boolean> {
  const key = conversationKey(message.channel, message.threadTs, message.ts, false);
  const existing = await store.getConversation(key);
  return Boolean(existing);
}

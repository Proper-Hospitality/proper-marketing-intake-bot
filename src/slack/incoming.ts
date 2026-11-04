import type { DesignDeps } from "../agent/run.js";

/**
 * Bot events Elena must subscribe in the Slack app. Channel and private-channel
 * thread replies, including file uploads, are not app_mention events.
 */
export const REQUIRED_BOT_EVENTS = [
  "app_mention",
  "message.im",
  "message.channels",
  "message.groups",
  "message.mpim",
] as const;

export interface NormalizedSlackMessage {
  channel: string;
  userId: string;
  text: string;
  ts: string;
  threadTs?: string;
  isDm: boolean;
  files: string[];
  uploads: DesignDeps["uploads"];
  edited: boolean;
}

interface SlackFile {
  id?: string;
  name?: string | null;
  permalink?: string;
}

export interface SlackMessageShape {
  type?: string;
  subtype?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  files?: SlackFile[];
  message?: SlackMessageShape;
}

const HANDLED_SUBTYPES = new Set(["file_share"]);

export function normalizeSlackMessage(event: SlackMessageShape): NormalizedSlackMessage | null {
  if (event.subtype === "message_changed") {
    const inner = event.message;
    if (!inner || inner.bot_id || !inner.user) return null;
    if (inner.subtype && !HANDLED_SUBTYPES.has(inner.subtype)) return null;
    return fromMessage(event.channel, event.channel_type, inner, true);
  }
  if (event.type && event.type !== "message" && event.type !== "app_mention") return null;
  if (event.subtype && !HANDLED_SUBTYPES.has(event.subtype)) return null;
  if (event.bot_id || !event.user) return null;
  return fromMessage(event.channel, event.channel_type, event, false);
}

export function messageClaimKey(message: Pick<NormalizedSlackMessage, "channel" | "ts" | "text" | "uploads">): string {
  const files = message.uploads.map((upload) => upload.slackFileId).filter(Boolean).sort().join(",");
  const text = message.text.replace(/\s+/g, " ").trim();
  return `msg:${message.channel}:${message.ts}:${text}:${files}`;
}

/** A channel thread reply is ours only when this thread already has a conversation. */
export function shouldHandleThreadReply(input: { isDm: boolean; threadTs?: string; hasConversation: boolean }): boolean {
  if (input.isDm) return true;
  return Boolean(input.threadTs && input.hasConversation);
}

function fromMessage(
  channel: string | undefined,
  channelType: string | undefined,
  source: SlackMessageShape,
  edited: boolean,
): NormalizedSlackMessage | null {
  if (!channel || !source.user || !source.ts) return null;
  const uploads = (source.files ?? []).flatMap((file) => (
    file.id ? [{ source: "slack" as const, slackFileId: file.id, name: file.name ?? undefined }] : []
  ));
  return {
    channel,
    userId: source.user,
    text: source.text ?? "",
    ts: source.ts,
    threadTs: source.thread_ts,
    isDm: channelType === "im",
    files: (source.files ?? []).map((file) => file.name || file.id || file.permalink || "").filter((name): name is string => Boolean(name)),
    uploads,
    edited,
  };
}

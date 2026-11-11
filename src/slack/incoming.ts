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

export function intakeChannelIds(raw = process.env.SLACK_INTAKE_CHANNELS): Set<string> {
  return new Set((raw ?? "").split(/[,\s]+/).map((id) => id.trim()).filter(Boolean));
}

interface SlackFile {
  id?: string;
  name?: string | null;
  permalink?: string;
  mimetype?: string;
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

/** Same channel and timestamp, so an @mention and the matching message event run once. */
export function messageOnceKey(message: Pick<NormalizedSlackMessage, "channel" | "ts">): string {
  return `msg:${message.channel}:${message.ts}`;
}

/**
 * DMs always count. A channel message counts when it @mentions the bot, when it
 * is a top-level post in an intake channel, or when it is a reply in a thread
 * the bot already owns. Edits of a root message and edits that have no thread
 * yet are ignored.
 */
export function shouldHandleIncoming(input: {
  isDm: boolean;
  mentioned: boolean;
  threadTs?: string;
  messageTs: string;
  hasConversation: boolean;
  intakeChannel: boolean;
  edited: boolean;
}): boolean {
  if (input.mentioned || input.isDm) return true;
  const rootEdit = input.edited && (!input.threadTs || input.threadTs === input.messageTs);
  if (rootEdit || (input.edited && !input.hasConversation)) return false;
  if (input.threadTs && input.threadTs !== input.messageTs && input.hasConversation) return true;
  const topLevel = !input.threadTs || input.threadTs === input.messageTs;
  return input.intakeChannel && topLevel && !input.edited;
}

/** A channel thread reply is ours only when this thread already has a conversation. */
export function shouldHandleThreadReply(input: { isDm: boolean; threadTs?: string; hasConversation: boolean }): boolean {
  return shouldHandleIncoming({
    isDm: input.isDm,
    mentioned: false,
    threadTs: input.threadTs,
    messageTs: "reply",
    hasConversation: input.hasConversation,
    intakeChannel: false,
    edited: false,
  });
}

function fromMessage(
  channel: string | undefined,
  channelType: string | undefined,
  source: SlackMessageShape,
  edited: boolean,
): NormalizedSlackMessage | null {
  if (!channel || !source.user || !source.ts) return null;
  const uploads = (source.files ?? []).flatMap((file) => {
    if (!file.id) return [];
    const upload: NormalizedSlackMessage["uploads"][number] = {
      source: "slack",
      slackFileId: file.id,
      name: file.name ?? undefined,
    };
    if (file.permalink) upload.permalink = file.permalink;
    if (file.mimetype) upload.mimetype = file.mimetype;
    return [upload];
  });
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

import { htmlToText, hasRequestContent, isAutomaticEmail, parseAddress, resolveParties } from "./parse.js";
import type { EmailFileRef, EmailParty, InboundEmail } from "./types.js";
import type { SlackEmailFileDetails } from "../../slack/files.js";

/**
 * Slack's Email app ("Send emails to this channel") posts into the channel as
 * a bot message with an email file. The live payload was not available to verify.
 * This accepts the file fields Slack's API documents for that feature, either on
 * the event or from files.info: filetype or mode "email", from, subject,
 * plain_text, and headers. Attachments may be nested on that file or siblings
 * on the message. A bot_message whose username is Email is also accepted.
 */

interface SlackEmailAddress {
  name?: string;
  address?: string;
  original?: string;
}

interface SlackEmailFile {
  id?: string;
  name?: string | null;
  title?: string | null;
  permalink?: string;
  mimetype?: string;
  filetype?: string;
  mode?: string;
  subject?: string;
  plain_text?: string;
  preview_plain_text?: string;
  preview?: string;
  from?: SlackEmailAddress[];
  headers?: unknown;
  attachments?: SlackEmailFile[];
}

export interface SlackEmailEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  bot_profile?: { name?: string };
  files?: SlackEmailFile[];
  attachments?: Array<{ title?: string; text?: string; fallback?: string; pretext?: string }>;
}

export type EmailResolution =
  | { status: "ignore" }
  | { status: "noise"; reason: string }
  | { status: "email"; email: InboundEmail };

export function emailIntakeChannelIds(raw = process.env.SLACK_EMAIL_INTAKE_CHANNELS): Set<string> {
  return new Set((raw ?? "").split(/[,\s]+/).map((id) => id.trim()).filter(Boolean));
}

export async function resolveInboundEmail(event: SlackEmailEvent, options: {
  botId?: string;
  botUserId?: string;
  loadEmailFile?: (fileId: string) => Promise<SlackEmailFileDetails | undefined>;
}): Promise<EmailResolution> {
  if (!event.channel || !event.ts) return { status: "ignore" };
  if (!isTopLevel(event)) return { status: "ignore" };
  if (options.botId && event.bot_id === options.botId) return { status: "ignore" };
  if (options.botUserId && event.user === options.botUserId) return { status: "ignore" };
  if (!looksLikeEmail(event)) return { status: "ignore" };

  const emailFile = (event.files ?? []).find(isEmailFile);
  let details: SlackEmailFileDetails | undefined;
  if (emailFile?.id && !emailText(emailFile) && options.loadEmailFile) {
    try {
      details = await options.loadEmailFile(emailFile.id);
    } catch (error) {
      console.error(JSON.stringify({
        msg: "email_file_read_failed",
        fileId: emailFile.id,
        error: error instanceof Error ? error.message : "unknown",
      }));
    }
  }

  const subject = (emailFile?.subject || details?.subject || event.attachments?.[0]?.title || event.text || "").trim();
  const body = htmlToText(
    emailText(emailFile)
    || details?.plainText
    || event.attachments?.[0]?.text
    || event.attachments?.[0]?.pretext
    || event.text
    || "",
  ).slice(0, 20000);
  const envelope = partyFromSlack(emailFile?.from?.[0] ?? details?.from?.[0]);
  const headers = emailFile?.headers ?? details?.headers;
  if (isAutomaticEmail({ subject, body, headers })) return { status: "noise", reason: "automatic" };
  if (!hasRequestContent(subject, body)) return { status: "noise", reason: "empty" };

  const parties = resolveParties({ body, subject, envelope });
  return {
    status: "email",
    email: {
      source: "slack-channel-email",
      channel: event.channel,
      messageTs: event.ts,
      slackUserId: event.bot_id ? undefined : event.user,
      forwarder: parties.forwarder,
      originalSender: parties.original,
      forwarded: parties.forwarded,
      subject: subject || "(no subject)",
      bodyText: body,
      files: collectFiles(event, emailFile, details),
    },
  };
}

function isTopLevel(event: SlackEmailEvent): boolean {
  if (event.subtype === "message_changed" || event.subtype === "message_deleted") return false;
  if (!event.thread_ts) return true;
  return event.thread_ts === event.ts;
}

function looksLikeEmail(event: SlackEmailEvent): boolean {
  if ((event.files ?? []).some(isEmailFile)) return true;
  const username = event.username || event.bot_profile?.name || "";
  return /^email$/i.test(username.trim()) && Boolean(event.text || event.attachments?.length);
}

function isEmailFile(file: SlackEmailFile | undefined): boolean {
  if (!file) return false;
  const type = `${file.filetype ?? ""} ${file.mode ?? ""} ${file.mimetype ?? ""} ${file.name ?? ""}`.toLowerCase();
  return file.filetype === "email" || file.mode === "email" || /message\/rfc822|\.eml\b/.test(type);
}

function emailText(file: SlackEmailFile | undefined): string {
  if (!file) return "";
  return file.plain_text || file.preview_plain_text || file.preview || "";
}

function partyFromSlack(from: SlackEmailAddress | undefined): EmailParty | undefined {
  if (!from) return undefined;
  if (from.original) return parseAddress(from.original);
  if (!from.name && !from.address) return undefined;
  return { name: from.name, email: from.address };
}

function collectFiles(
  event: SlackEmailEvent,
  emailFile: SlackEmailFile | undefined,
  details: SlackEmailFileDetails | undefined,
): EmailFileRef[] {
  const refs: EmailFileRef[] = [];
  const seen = new Set<string>();
  const push = (file: { id?: string; name?: string | null; mimetype?: string; permalink?: string } | undefined, role: EmailFileRef["role"]) => {
    if (!file?.id || seen.has(file.id)) return;
    seen.add(file.id);
    refs.push({
      slackFileId: file.id,
      name: (typeof file.name === "string" ? file.name.trim() : "") || (role === "email" ? "email.eml" : "attachment"),
      permalink: file.permalink,
      mimetype: file.mimetype,
      role,
    });
  };
  push(emailFile, "email");
  if (details?.name && refs[0]?.role === "email") refs[0].name = details.name;
  if (details?.permalink && refs[0]?.role === "email" && !refs[0].permalink) refs[0].permalink = details.permalink;
  if (details?.mimetype && refs[0]?.role === "email" && !refs[0].mimetype) refs[0].mimetype = details.mimetype;
  for (const nested of emailFile?.attachments ?? []) push(nested, "attachment");
  for (const nested of details?.attachments ?? []) push(nested, "attachment");
  for (const file of event.files ?? []) {
    if (file === emailFile || isEmailFile(file)) continue;
    push(file, "attachment");
  }
  return refs;
}

import { htmlToText, parseSlackEmailDocument } from "../intake/email/parse.js";

export async function downloadSlackFile(args: {
  token: string;
  fileId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ name: string; bytes: Uint8Array; permalink?: string; mimetype?: string }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const infoResponse = await fetchImpl(`https://slack.com/api/files.info?file=${encodeURIComponent(args.fileId)}`, {
    headers: { Authorization: `Bearer ${args.token}` },
  });
  const info = await infoResponse.json() as {
    ok?: boolean;
    error?: string;
    file?: { name?: string; mimetype?: string; permalink?: string; url_private?: string; url_private_download?: string };
  };
  if (!info.ok || !info.file) throw new Error(info.error || "Slack could not find that file. The bot needs the files:read scope.");
  const url = info.file.url_private_download || info.file.url_private;
  if (!url) throw new Error("Slack did not include a download link for that file.");
  const downloaded = await readBytes({
    url,
    name: info.file.name || "attachment",
    token: args.token,
    fetchImpl,
  });
  return {
    ...downloaded,
    permalink: info.file.permalink,
    mimetype: info.file.mimetype,
  };
}

export interface SlackEmailFileDetails {
  subject?: string;
  plainText?: string;
  from?: Array<{ name?: string; address?: string; original?: string }>;
  headers?: unknown;
  attachments?: Array<{ id?: string; name?: string | null; mimetype?: string; permalink?: string }>;
  name?: string;
  mimetype?: string;
  permalink?: string;
}

/**
 * files.info for a Slack email file. The event often omits plain_text; the
 * file object from files.info is where subject, from, and the body show up.
 * Field names follow Slack's email file object. The live Email app payload
 * was not available to verify.
 */
export async function readSlackEmailFile(args: {
  token: string;
  fileId: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackEmailFileDetails | undefined> {
  const fetchImpl = args.fetchImpl ?? fetch;
  try {
    const infoResponse = await fetchImpl(`https://slack.com/api/files.info?file=${encodeURIComponent(args.fileId)}`, {
      headers: { Authorization: `Bearer ${args.token}` },
    });
    const info = await infoResponse.json() as {
      ok?: boolean;
      error?: string;
      file?: {
        name?: string;
        mimetype?: string;
        permalink?: string;
        url_private?: string;
        url_private_download?: string;
        subject?: string;
        plain_text?: string;
        preview_plain_text?: string;
        preview?: string;
        from?: Array<{ name?: string; address?: string; original?: string }>;
        headers?: unknown;
        attachments?: Array<{ id?: string; name?: string | null; mimetype?: string; permalink?: string }>;
      };
    };
    if (!info.ok || !info.file) return undefined;
    const file = info.file;
    let plainText = file.plain_text || file.preview_plain_text || "";
    if (!plainText) {
      const url = file.url_private_download || file.url_private;
      const textual = /text\/|message\/rfc822|html|email/i.test(`${file.mimetype ?? ""} ${file.name ?? ""}`);
      if (url && textual) {
        const downloaded = await readBytes({
          url,
          name: file.name || "email",
          token: args.token,
          fetchImpl,
        });
        plainText = new TextDecoder().decode(downloaded.bytes);
      }
    }
    const document = plainText ? parseSlackEmailDocument(plainText) : undefined;
    const source = document?.plainText || plainText;
    const text = source ? htmlToText(source).slice(0, 20000) : "";
    const from = file.from ?? (document?.from ? [{ original: document.from }] : undefined);
    return {
      subject: file.subject || document?.subject,
      plainText: text || undefined,
      from,
      headers: file.headers,
      attachments: file.attachments,
      name: file.name,
      mimetype: file.mimetype,
      permalink: file.permalink,
    };
  } catch (error) {
    console.error(JSON.stringify({
      msg: "email_file_read_failed",
      fileId: args.fileId,
      error: error instanceof Error ? error.message : "unknown",
    }));
    return undefined;
  }
}

export async function downloadRemoteFile(args: {
  url: string;
  name?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ name: string; bytes: Uint8Array }> {
  const slackFile = /slack\.com|slack-files\.com/.test(args.url);
  return readBytes({
    url: args.url,
    name: args.name || "photo",
    token: slackFile ? args.token : undefined,
    fetchImpl: args.fetchImpl,
  });
}

async function readBytes(args: {
  url: string;
  name: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ name: string; bytes: Uint8Array }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(args.url, {
    headers: args.token ? { Authorization: `Bearer ${args.token}` } : {},
  });
  if (!response.ok) throw new Error(`Could not download ${args.name}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error(`${args.name} is over 20 MB. Send a smaller file.`);
  if (bytes.byteLength === 0) throw new Error(`${args.name} was empty.`);
  return { name: args.name, bytes };
}

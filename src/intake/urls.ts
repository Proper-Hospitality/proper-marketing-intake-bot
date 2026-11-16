import { FORM_URL } from "./catalog.js";

const SLACK_LINK = /<(https?:\/\/[^|>\s]+)(?:\|([^>]*))?>/gi;

/** A pasted Asana task is an example of the form, not a link for this request. */
export function isExampleTaskLink(url: string): boolean {
  return /app\.asana\.com\/\d+\//i.test(url);
}

/**
 * Slack writes links as <url|label>. The label is not part of the URL.
 * A truncated label ends in an ellipsis and must not be kept either.
 */
export function cleanCapturedUrl(raw: string): string {
  let url = raw.trim().replace(/[.,;]+$/, "");
  const pipe = url.indexOf("|");
  if (pipe >= 0) url = url.slice(0, pipe);
  url = url.replace(/%7C.*$/i, "");
  try {
    url = decodeURIComponent(url);
  } catch {
    // keep the raw URL when it is not valid percent-encoding
  }
  url = url.replace(/%7C.*$/i, "").replace(/[|].*$/, "");
  url = url.replace(/[\u2026.]+$/u, "");
  return url;
}

/**
 * The requester's words, ready to store.
 * Slack <url|label> keeps the URL. Everything else is only trimmed.
 */
/**
 * Drop the bot's file summary. It is not part of an answer, a title, or a filed note.
 * Slack <url|label> is resolved first. A slack.com/files URL is removed either way.
 */
export function stripFileEcho(text: string): string {
  return text
    .replace(/\s*Files attached \(saved on this request\):[\s\S]*$/i, "")
    .replace(/\n?Files:\s*[^\n]*\((?:ID…|[A-Z0-9]{6,})[^)\n]*\)[^\n]*$/i, "")
    .replace(/https?:\/\/\S*slack\.com\/files\/\S*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function exactAnswer(text: string): string {
  const links = text.replace(SLACK_LINK, "$1");
  return stripFileEcho(links.split("\n").map((line) => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n"));
}

export function captureUrls(text: string): string[] {
  const found: string[] = [];
  const take = (raw: string | undefined) => {
    if (!raw) return;
    const url = cleanCapturedUrl(raw);
    if (!url.startsWith("http")) return;
    if (url === FORM_URL || isExampleTaskLink(url) || found.includes(url)) return;
    found.push(url);
  };
  for (const match of text.matchAll(SLACK_LINK)) take(match[1]);
  const stripped = text.replace(SLACK_LINK, " ");
  for (const match of stripped.matchAll(/https?:\/\/[^\s<>)\]]+/g)) take(match[0]);
  return found;
}

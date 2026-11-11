import type { EmailParty, EmailProposal } from "./types.js";

const FORWARD_MARK = /-{2,}\s*forwarded message\s*-{2,}|begin forwarded message:/i;
const ITEM = /^(?:[-*•]\s+)?(?:\(([a-z]|\d{1,2})\)|([a-z]|\d{1,2})[.)])\s+(\S.*)$/i;
const REQUEST = /\b(please|can you|could you|we need|need to|add|send|create|update|design|build|edit|merge|make|set up|help with|request)\b/i;

export function formatParty(party: EmailParty | undefined): string {
  if (!party) return "Unknown";
  const name = [party.name, party.title].filter(Boolean).join(", ");
  if (name && party.email) return `${name} <${party.email}>`;
  return name || party.email || "Unknown";
}

export function parseAddress(raw: string): EmailParty {
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  const angle = trimmed.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    const display = angle[1].replace(/^["']|["']$/g, "").trim().replace(/,\s*$/, "");
    return { ...splitTitle(display), email: angle[2].trim() };
  }
  if (trimmed.includes("@") && !trimmed.includes(" ")) return { email: trimmed };
  return splitTitle(trimmed);
}

export function resolveParties(input: {
  body: string;
  subject: string;
  envelope?: EmailParty;
}): { original: EmailParty; forwarder: EmailParty; forwarded: boolean } {
  const marker = input.body.search(FORWARD_MARK);
  const region = marker >= 0 ? input.body.slice(marker) : input.body;
  const inner = firstFrom(region);
  const envelope = input.envelope;
  const different = Boolean(
    inner?.email && envelope?.email && inner.email.toLowerCase() !== envelope.email.toLowerCase(),
  );
  const forwarded = different || (marker >= 0 && Boolean(inner?.email) && !envelope?.email);
  if (forwarded && inner) {
    return { original: inner, forwarder: envelope ?? inner, forwarded: true };
  }
  const party = envelope ?? inner ?? {};
  return { original: party, forwarder: party, forwarded: false };
}

export function isAutomaticEmail(input: { subject: string; body: string; headers?: unknown }): boolean {
  const subject = input.subject.trim();
  if (/^(auto(?:matic)?(?:\s*reply)?:|automatic reply\b|out of office\b|ooo\b|away:|undeliverable\b|delivery status notification|mail delivery (?:failed|subsystem)|returned mail:|autoreply:)/i.test(subject)) {
    return true;
  }
  const headers = headerBlob(input.headers);
  if (/auto-submitted["']?\s*[:=]\s*["']?auto-(?:replied|generated)/i.test(headers)) return true;
  if (/\b(this is an automatic reply|i am currently out of the office|i'm out of the office|i will be out of the office)\b/i.test(input.body)) {
    return true;
  }
  return false;
}

export function hasRequestContent(subject: string, body: string): boolean {
  const stripped = stripBoilerplate(extractForwardedBody(body) || body)
    .replace(/\b(fw|fwd)\s*:/gi, "")
    .trim();
  const text = `${subject}\n${stripped}`.replace(/\b(fw|fwd)\s*:/gi, "").trim();
  if (text.length < 40) return false;
  if (/^(thanks|thank you|fyi|see below|looping you in)[.!\s]*$/i.test(stripped)) return false;
  if (!REQUEST.test(text) && stripped.length < 160) return false;
  return true;
}

export function proposeEmailBriefs(input: { subject: string; bodyText: string }): EmailProposal[] {
  const cleaned = stripSignature(input.bodyText);
  const asks = splitAsks(cleaned);
  const pieces = asks.length >= 2 ? asks : [extractForwardedBody(cleaned) || cleaned];
  return pieces
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 0)
    .map((detail) => classifyAsk(detail, input.subject));
}

export function parseSplitChoice(text: string): "split" | "one" | "unclear" {
  const trimmed = text.trim();
  if (/\b(keep (it |them )?(as )?one|one task|single task|don'?t split|do not split|together)\b/i.test(trimmed)) return "one";
  if (/^(yes|yep|yeah|yup|split|ok|okay|sure|do it|please|confirm)[.!]?$/i.test(trimmed)) return "split";
  if (/\bsplit\b/i.test(trimmed) && !/\b(don'?t|do not)\b/i.test(trimmed)) return "split";
  return "unclear";
}

export function userCorrectsEmailRequester(text: string): boolean {
  return /\b(requester|original sender|their email|change the name|filed for)\b/i.test(text);
}

export function userCorrectsEmailType(text: string): boolean {
  return /\b(request type|task type|not a web|not web|this is (?:a |an )?(?:web|creative|crm|social|marketing))\b/i.test(text);
}

export function renderEmailText(input: {
  subject: string;
  originalRequester: string;
  forwarder: string;
  forwarded: boolean;
  bodyText: string;
}): string {
  return [
    `Subject: ${input.subject}`,
    `From: ${input.originalRequester}`,
    input.forwarded ? `Forwarded by: ${input.forwarder}` : `Sent by: ${input.forwarder}`,
    "",
    input.bodyText,
  ].join("\n");
}

const REAL_HTML = /<\/?[a-z][a-z0-9]*(?:\s[^<>]*|\/?)>/i;

export function htmlToText(value: string): string {
  const trimmed = value.trim();
  if (!REAL_HTML.test(trimmed)) return trimmed;
  return trimmed
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function classifyAsk(detail: string, subject: string): EmailProposal {
  const text = `${subject}\n${detail}`;
  if (/\b(merge|dedup|categor)/i.test(detail) && /\b(info@|events|contacts|people|list)\b/i.test(detail)) {
    return {
      title: "Merge interest contacts",
      detail,
      requestType: "CRM & Paid",
      taskType: "New User Journey (Subscriber Flows)",
      followUps: {
        "Audience / Distribution Plan": detail,
        "Recommended Copy / Details": detail,
      },
    };
  }
  if (/\b(questionnaire|survey)\b/i.test(detail) || (/\bsend\b/i.test(detail) && /\b(list|audience)\b/i.test(detail))) {
    const list = detail.match(/hand-built 500\+\s*person membership interest list/i)?.[0];
    return {
      title: "Membership interest questionnaire",
      detail,
      requestType: "CRM & Paid",
      taskType: "Newsletter Send",
      followUps: {
        "Audience / Distribution Plan": list ?? detail,
        "Recommended Copy / Details": detail,
      },
      whereItGoesLive: list,
    };
  }
  if (/\bplan\b/i.test(detail) && /\b(update|cadence|launch|share|often)\b/i.test(detail)) {
    return {
      title: "Project update plan",
      detail,
      requestType: "Marketing",
      taskType: "Marketing Plan",
      followUps: { "Detailed Request": detail },
    };
  }
  if (/\b(web ?page|webpage|homepage|landing page|form fields?|interest form)\b/i.test(text)) {
    const lake = /lake tahoe/i.test(text);
    const form = /\bform\b/i.test(detail);
    const title = form
      ? (lake ? "Lake Tahoe membership interest form" : "Membership page interest form")
      : clipTitle(detail);
    return {
      title,
      detail,
      requestType: "Web",
      taskType: "Page Edit",
      followUps: {
        "Page Change Details (exact copy provided, if required)": detail,
      },
    };
  }
  return { title: clipTitle(detail), detail };
}

function splitAsks(body: string): string[] {
  const items: string[] = [];
  let current: string[] | undefined;
  for (const line of body.split(/\r?\n/)) {
    const match = line.trim().match(ITEM);
    if (match?.[3]) {
      if (current) items.push(current.join("\n").trim());
      current = [match[3].trim()];
      continue;
    }
    if (current && line.trim()) current.push(line.trim());
  }
  if (current) items.push(current.join("\n").trim());
  const substantial = items.filter((item) => item.length >= 20);
  return substantial.length >= 2 ? substantial : [];
}

function extractForwardedBody(body: string): string {
  const marker = body.search(FORWARD_MARK);
  let text = marker >= 0 ? body.slice(marker) : body;
  text = text.replace(/^-{2,}\s*forwarded message\s*-{2,}\s*/i, "");
  text = text.replace(/^begin forwarded message:\s*/i, "");
  const lines = text.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && /^(from|date|sent|to|cc|subject|reply-to)\s*:/i.test(lines[index].trim())) index += 1;
  while (index < lines.length && !lines[index].trim()) index += 1;
  return lines.slice(index).join("\n").trim();
}

function stripSignature(body: string): string {
  return body.replace(/\n+(?:thanks|thank you|best|cheers),?\s*\n[\s\S]*$/i, "\n").trim();
}

function stripBoilerplate(body: string): string {
  return body
    .replace(/\n--\s*\n[\s\S]*$/m, "")
    .replace(/\nsent from my (?:iphone|ipad|android)[\s\S]*$/i, "")
    .trim();
}

function firstFrom(text: string): EmailParty | undefined {
  const match = text.match(/^[\s>]*from:\s*(.+)$/im);
  if (!match?.[1]) return undefined;
  const party = parseAddress(match[1]);
  if (!party.name && !party.email) return undefined;
  return party;
}

function splitTitle(display: string): EmailParty {
  const trimmed = display.trim();
  if (!trimmed) return {};
  const match = trimmed.match(/^(.*?),\s*((?:svp|evp|vp|director|manager|head|chief|president|coordinator)\b.*)$/i);
  if (!match) return { name: trimmed };
  return { name: match[1].trim(), title: match[2].trim() };
}

function clipTitle(detail: string): string {
  const sentence = detail.replace(/\s+/g, " ").trim().split(/[.!?]/)[0] ?? detail;
  if (sentence.length <= 80) return sentence;
  return `${sentence.slice(0, 79).trim()}…`;
}

function headerBlob(headers: unknown): string {
  if (!headers) return "";
  if (typeof headers === "string") return headers;
  try {
    return JSON.stringify(headers);
  } catch {
    return "";
  }
}

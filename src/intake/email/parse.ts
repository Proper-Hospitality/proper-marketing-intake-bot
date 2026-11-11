import { canonicalizeProperty, inferProperties } from "../catalog.js";
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
  const froms = headerFromParties(input.body);
  const inner = froms.at(-1) ?? firstFrom(input.body);
  const envelope = input.envelope ?? froms[0];
  const different = Boolean(
    inner?.email && envelope?.email && inner.email.toLowerCase() !== envelope.email.toLowerCase(),
  );
  const forwarded = different || froms.length > 1 || (input.body.search(FORWARD_MARK) >= 0 && Boolean(inner?.email) && !input.envelope?.email);
  if (forwarded && inner) {
    return { original: inner, forwarder: envelope ?? inner, forwarded: true };
  }
  const party = envelope ?? inner ?? {};
  return { original: party, forwarder: party, forwarded: false };
}

/** From lines that sit in a real header block, outer forward first. */
export function headerFromParties(body: string): EmailParty[] {
  const lines = normalizeEmailText(body).split("\n");
  const parties: EmailParty[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^from:\s*.+@/i.test(lines[index]?.trim() ?? "")) continue;
    const window = lines.slice(index, index + 8).join("\n");
    if (!/(?:^|\n)(?:date|sent|to|cc|subject)\s*:/i.test(window)) continue;
    const party = parseAddress((lines[index] ?? "").replace(/^from:\s*/i, "").trim());
    if (party.email || party.name) parties.push(party);
  }
  return parties;
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
  const cleaned = cleanEmailBody(input.bodyText);
  const numbered = splitAsks(cleaned);
  const prose = numbered.length >= 2 ? numbered : splitProseAsks(cleaned);
  const pieces = prose.length >= 2 ? prose : [cleaned];
  return pieces
    .map((detail) => detail.trim())
    .filter((detail) => detail.length > 0)
    .map((detail) => {
      const proposal = classifyAsk(detail, input.subject);
      proposal.detail = detail;
      proposal.summary = summarizeAsk(detail, proposal.title);
      return proposal;
    });
}

/**
 * A short reply while we are confirming an inferred property.
 * Longer messages fall through so the model can record several answers at once.
 */
export function interpretPropertyConfirm(
  text: string,
  inferred: string[],
): "accept" | "decline" | "unclear" | { properties: string[] } {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 160) return "unclear";
  if (/^(no|nope|nah)[.!]?$/i.test(trimmed)) return "decline";
  const direct = canonicalizeProperty(trimmed);
  const named = direct ? [direct] : inferProperties(trimmed);
  const affirm = /^(yes|yep|yeah|yup|correct|right|that'?s right|that is right|ok|okay|sure|sounds good|please do)[.!]?$/i.test(trimmed);
  if (affirm && named.length === 0) return "accept";
  if (named.length === 0) return "unclear";
  const same = named.every((code) => inferred.includes(code)) && named.length === inferred.length;
  if (same || (affirm && named.every((code) => inferred.includes(code)))) return "accept";
  return { properties: named };
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

/** Slack sometimes stores the channel-email file as JSON with body-plain and body-html. */
export function parseSlackEmailDocument(raw: string): { subject?: string; plainText?: string; from?: string } | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const data = JSON.parse(trimmed) as Record<string, unknown>;
    const plain = typeof data["body-plain"] === "string" ? data["body-plain"] : undefined;
    const html = typeof data["body-html"] === "string" ? data["body-html"] : undefined;
    const subject = typeof data.subject === "string" ? data.subject : undefined;
    const from = typeof data.from === "string" ? data.from : undefined;
    const plainText = plain?.trim() || (html ? htmlToText(html) : undefined);
    if (!plainText && !subject && !from) return undefined;
    return { subject, plainText, from };
  } catch {
    return undefined;
  }
}

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
      title: "Merge and clean interest contacts",
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
  const substantial = items.filter((item) => item.length >= 20 && REQUEST.test(item));
  return substantial.length >= 2 ? substantial : [];
}

type AskKind = "form" | "questionnaire" | "merge" | "plan";

function splitProseAsks(body: string): string[] {
  const paragraphs = body.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const groups: Array<{ kind: AskKind; parts: string[] }> = [];
  const index = new Map<AskKind, number>();
  const add = (kind: AskKind, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const at = index.get(kind);
    if (at === undefined) {
      index.set(kind, groups.length);
      groups.push({ kind, parts: [trimmed] });
      return;
    }
    groups[at]?.parts.push(trimmed);
  };
  for (const paragraph of paragraphs) {
    const kinds = askKinds(paragraph);
    if (kinds.length === 0) continue;
    if (kinds.length === 1) {
      const kind = kinds[0];
      if (kind) add(kind, paragraph);
      continue;
    }
    let last: AskKind | undefined;
    const held: string[] = [];
    for (const sentence of splitSentences(paragraph)) {
      const kind = askKinds(sentence)[0];
      if (!kind) {
        if (last) add(last, sentence);
        else held.push(sentence);
        continue;
      }
      if (held.length > 0) {
        const heldText = held.join(" ");
        if (heldText.length > 40) add(kind, heldText);
        held.length = 0;
      }
      add(kind, sentence);
      last = kind;
    }
  }
  if (groups.length < 2) return [];
  return groups.map((group) => group.parts.join("\n\n").trim());
}

function askKinds(text: string): AskKind[] {
  const kinds: AskKind[] = [];
  if (/\b(interest form|form fields?|page form|membership page|web ?page|landing page|homepage)\b/i.test(text)) {
    kinds.push("form");
  }
  if (/\b(questionnaire|survey)\b/i.test(text)) kinds.push("questionnaire");
  if (
    (/\b(merge|dedup(?:e|licate)?|categori[sz]e)\b/i.test(text) && /\b(info@|events|contacts|people|list|database)\b/i.test(text))
    || (/\binfo@\b|\bthrough events\b/i.test(text) && /\b(database|reached out|merge|contacts|people)\b/i.test(text))
  ) {
    kinds.push("merge");
  }
  if (/\bplan\b/i.test(text) && /\b(updates?|cadence|launch|share|often|owns)\b/i.test(text)) kinds.push("plan");
  return kinds;
}

function splitSentences(paragraph: string): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const line of paragraph.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-*•]\s+/.test(trimmed)) {
      if (current) pieces.push(current.trim());
      current = "";
      pieces.push(trimmed);
      continue;
    }
    current = current ? `${current} ${trimmed}` : trimmed;
  }
  if (current) pieces.push(current.trim());
  const sentences: string[] = [];
  for (const piece of pieces) {
    if (/^[-*•]/.test(piece)) {
      sentences.push(piece);
      continue;
    }
    sentences.push(...piece.split(/(?<=[.!?])\s+(?=[A-Z])/).map((part) => part.trim()).filter(Boolean));
  }
  return sentences;
}

function summarizeAsk(detail: string, title: string): string {
  const lines = detail.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => /^[-*•]\s+/.test(line));
  const prose = lines.filter((line) => !/^[-*•]\s+/.test(line)).join(" ");
  const sentences = prose.split(/(?<=[.!?])\s+(?=[A-Z])/).map((part) => part.trim()).filter(Boolean);
  const ask = sentences.find((sentence) => REQUEST.test(sentence)) ?? sentences[0] ?? title;
  const extra = sentences.find((sentence) => sentence !== ask && /500\+|info@|\bhow often\b|\bwho owns\b/i.test(sentence));
  const lead = [extra, ask].filter(Boolean).join(" ").replace(/^(?:separately|additionally|also|in addition),?\s+/i, "");
  if (bullets.length >= 2) return `${lead}\n${bullets.join("\n")}`;
  return clipAtBoundary(lead, 500);
}

function clipAtBoundary(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("; "));
  if (end > 80) return cut.slice(0, end + 1).trim();
  const space = cut.lastIndexOf(" ");
  if (space > 40) return cut.slice(0, space).trim();
  return flat;
}

export function cleanEmailBody(body: string): string {
  let text = normalizeEmailText(body);
  text = extractForwardedBody(text);
  text = afterLastHeader(text);
  text = stripSignature(text);
  text = stripDisclaimer(text);
  text = text
    .replace(/^\s*>.*$/gm, "")
    .replace(/\n+On .+wrote:\s*\n[\s\S]*$/i, "")
    .replace(/\n+-----Original Message-----[\s\S]*$/i, "")
    .replace(/\[cid:[^\]]+\]/gi, "")
    .replace(/^\s*Proper Hotels\s*\|.*$/gim, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

function normalizeEmailText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u2011/g, "-")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+(From|Date|Sent|To|Cc|Bcc|Subject|Reply-To)\s*:/gi, "\n$1:")
    .replace(/^(subject:[^\n]*?)\s+(?=(?:hi|hello|hey)\b)/gim, "$1\n\n")
    .replace(/\s+(Thanks|Thank you|Best|Cheers|Disclaimer)\b/gi, "\n$1")
    .replace(/\s+-\s+(?=[A-Z0-9])/g, "\n- ")
    .replace(/(\(Yes\s*\/\s*No\))\s+(?=[A-Z])/gi, "$1\n")
    .replace(/\s+(?=Separately\b|Additionally\b|In addition\b)/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function afterLastHeader(body: string): string {
  const lines = body.split(/\n/);
  let last = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^from:\s*.+@/i.test(lines[index]?.trim() ?? "")) continue;
    const window = lines.slice(index, index + 8).join("\n");
    if (!/(?:^|\n)(?:date|sent|to|cc|subject)\s*:/i.test(window)) continue;
    let cursor = index;
    while (cursor < lines.length && /^(from|date|sent|to|cc|bcc|subject|reply-to)\s*:/i.test(lines[cursor]?.trim() ?? "")) cursor += 1;
    while (cursor < lines.length && !lines[cursor]?.trim()) cursor += 1;
    last = cursor;
  }
  if (last < 0) return body;
  return lines.slice(last).join("\n").trim();
}

function stripDisclaimer(body: string): string {
  return body
    .replace(/\n+Disclaimer\b[\s\S]*$/i, "")
    .replace(/\n+The information contained in this communication[\s\S]*$/i, "")
    .replace(/\n+This email has been scanned for viruses[\s\S]*$/i, "")
    .trim();
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
  const match = body.search(/\n(?:thanks|thank you|best|cheers),?(?:\s|$)/i);
  if (match < 0) return body.replace(/\n+(?:thanks|thank you|best|cheers),?\s*\n[\s\S]*$/i, "\n").trim();
  const tail = body.slice(match);
  const signoff = /\b(manager|director|president|vice president|svp|disclaimer|proper hotels|\(\d{3}\))|\n[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\s*$/i.test(tail);
  if (!signoff && tail.trim().length > 80) return body;
  return body.slice(0, match).trim();
}

function stripBoilerplate(body: string): string {
  return body
    .replace(/\n--\s*\n[\s\S]*$/m, "")
    .replace(/\nsent from my (?:iphone|ipad|android)[\s\S]*$/i, "")
    .trim();
}

function firstFrom(text: string): EmailParty | undefined {
  const labeled = [...text.matchAll(/(?:^|\n)\s*from:\s*(.+)$/gim)].map((match) => match[1]?.trim()).filter(Boolean);
  if (labeled.length === 0) {
    const inline = text.match(/\bfrom:\s*([^<\n]{0,120}<[^>\s]+@[^>\s]+>)/i);
    if (inline?.[1]) labeled.push(inline[1].trim());
  }
  for (const raw of labeled) {
    const party = parseAddress(raw);
    if (party.email || party.name) return party;
  }
  return undefined;
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

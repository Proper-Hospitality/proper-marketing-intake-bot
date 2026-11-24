import { leadTimeFor } from "./lead-time.js";
import type { MissingItem } from "./missing.js";
import type { BriefDraft } from "./types.js";
import { captureUrls } from "./urls.js";
import { formatSpokenDate } from "./relative-date.js";

const MESSAGE_LIMIT = 300;

const FILE_QUESTION = "What images or photos should we use? Attach them here, share a link, or say none.";
const TEXT_QUESTION = "What should the text (copy) say?";
const CLICK_QUESTION = "What button or link should people click (CTA)?";
const AUDIENCE_QUESTION = "Who should get this, and where will they see it?";

/** User-facing wording for one follow-up. Plain language, no intake jargon. */
export function plainFollowUp(label: string, draft: BriefDraft): string {
  if (label === "URL") return pageLinkQuestion(draft);
  if (/page change/i.test(label)) return changeQuestion(draft);
  if (/page headline/i.test(label)) return "What's the headline?";
  if (/page copy/i.test(label)) return "What text (copy) should go on the page?";
  if (/audience|distribution/i.test(label)) return AUDIENCE_QUESTION;
  if (/copy for klaviyo/i.test(label)) return "What text (copy) should the popup show?";
  if (/photo for klaviyo|photo link|photo\/video|asset link|banner photo|organized assets|link to assets|inspiration link/i.test(label)) {
    return FILE_QUESTION;
  }
  if (/^cta/i.test(label)) return CLICK_QUESTION;
  if (/recommended copy|exact menu|event description/i.test(label)) return TEXT_QUESTION;
  if (/asset size/i.test(label)) return "What size should it be?";
  if (/paper size/i.test(label)) return "What paper size should we use?";
  if (/print quantity/i.test(label)) return "How many do you need printed?";
  if (/detailed/i.test(label)) return "What should we do?";
  if (/event name/i.test(label)) return "What's the event called?";
  if (/event date|event time/i.test(label)) return "When is the event? Include the start and end time.";
  if (/event location/i.test(label)) return "Where does the event happen?";
  if (/subject line/i.test(label)) return "What should the subject line (copy) say?";
  if (/rate code/i.test(label)) return "What's the rate code? Send it as it should appear.";
  if (/promo code/i.test(label)) return "What's the promo code? Send it as a guest would type it.";
  if (/offer title/i.test(label)) return "What's the offer called?";
  if (label === "Details" || label === "Instructions") return "What text (copy) should we use?";
  if (/platform/i.test(label)) return "Which website or ad account is this for?";
  if (/what it replaces/i.test(label)) return "What should come down, and where should this sit on the page?";
  if (/when the old offer/i.test(label)) return "When should the old offer come down?";
  if (/replaces it in ads/i.test(label)) return "What should replace it in ads or the usual campaigns?";
  if (/transactional/i.test(label)) return "Do any booking emails use this rate or promo code?";
  if (/offer copy/i.test(label)) return "Can you share the offer text (copy), the rules, and a photo?";
  const cleaned = label.replace(/\s*\([^)]*\)/g, "").trim();
  const sentence = cleaned.endsWith("?") ? cleaned : `${cleaned}?`;
  return sentence.length <= 160 ? sentence : `${sentence.slice(0, 157)}?`;
}

export function formatEasyAsk(input: {
  draft: BriefDraft;
  items: MissingItem[];
  opening: boolean;
}): { text: string; askedIds: string[] } {
  const picked = pickQuestions(input.items);
  if (picked.length === 0) return { text: "What else should I know?", askedIds: [] };
  const questions = picked.map((item) => plainItem(item, input.draft));
  let asked = picked;
  let body = joinAsk(questions);
  if (body.length > MESSAGE_LIMIT && questions.length > 1) {
    asked = [picked[0]];
    body = questions[0];
  }
  const intro = input.opening && input.draft.taskType ? openingLine(input.draft) : "";
  let text = intro ? `${intro} ${body}` : body;
  if (text.length > MESSAGE_LIMIT) text = body;
  if (text.length > MESSAGE_LIMIT) text = text.slice(0, MESSAGE_LIMIT - 1).trimEnd() + "?";
  return { text, askedIds: asked.map((item) => item.id) };
}

export function formatEasyConfirm(draft: BriefDraft): string {
  const place = draft.properties?.[0];
  const kind = confirmKind(draft);
  const subject = confirmSubject(draft);
  const when = draft.requestedCompletionDate ? `, live ${shortDate(draft.requestedCompletionDate)}` : "";
  const what = [place, kind].filter(Boolean).join(" ");
  const line = subject
    ? `I can file this ${what} for the ${subject}${when}.`
    : `I can file this ${what}${when}.`;
  const text = `${line} Click Confirm and I'll create the task.`;
  return text.length <= MESSAGE_LIMIT ? text : `I can file this ${what}${when}. Click Confirm to file it.`;
}

/** Store a reply that answered one or two plain questions. */
export function recordEasyReply(draft: BriefDraft, askedIds: string[], userText: string): boolean {
  const text = userText.trim();
  if (text.length < 2) return false;
  const urls = captureUrls(text);
  const rest = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:and|also)\s+/i, "")
    .trim();
  let recorded = false;
  for (const id of askedIds) {
    if (id === "followup:URL" || id.endsWith(":URL")) {
      if (!urls[0]) continue;
      draft.followUps = { ...(draft.followUps ?? {}), URL: urls[0] };
      if (!draft.whereItGoesLive) draft.whereItGoesLive = urls[0];
      recorded = true;
      continue;
    }
    if (id.startsWith("followup:") && rest.length >= 2) {
      const label = id.slice("followup:".length);
      draft.followUps = { ...(draft.followUps ?? {}), [label]: rest };
      draft.copyReady = true;
      recorded = true;
    }
  }
  return recorded;
}

export function plainItem(item: MissingItem, draft: BriefDraft): string {
  if (item.id === "requestedCompletionDate" || item.id === "timing") return liveDateQuestion(draft);
  if (item.id === "consequenceOfDelay") return "What happens if it's late?";
  if (item.id === "designNeeded") return "Do you need design help? If not, say no.";
  if (item.id === "attachmentProvide") {
    return /pdf|menu/i.test(item.label)
      ? "Can you attach the menu as a PDF? One menu per file. Say none if you don't have it."
      : "Can you attach the file, or share a link? Say none if you don't have it.";
  }
  if (item.id === "assets" || item.id === "menuPdf" || item.id.startsWith("attachment")) return FILE_QUESTION;
  if (item.id === "approver") return "Who needs to approve this?";
  if (item.id === "properties") return "Which hotel is this for? A code like SMB is fine.";
  if (item.id === "requestName") return "What should we call this?";
  if (item.id === "requesterName") return "Who is this for?";
  if (item.id === "requesterEmail") return "What's your email?";
  if (item.id === "requestType") return "What do you need help with? A page, an email, a social post, or something else?";
  if (item.id === "taskType") return taskTypeQuestion(draft);
  if (item.id === "copyReady" || item.id === "copy" || item.id === "copyPlan") return "Is the text (copy) ready? Paste it, or say who is writing it and when.";
  if (item.id === "whereItGoesLive") return "Where should this show up? A page link, an email, or a social account is enough.";
  if (item.id === "eventWhen") return "When is the event? Include the start and end time.";
  if (item.label === "URL" || item.id.endsWith(":URL")) return pageLinkQuestion(draft);
  return plainFollowUp(item.label, draft);
}

function pickQuestions(items: MissingItem[]): MissingItem[] {
  const blocking = items.find((item) =>
    ["requestType", "taskType", "properties", "requesterName", "requesterEmail"].includes(item.id),
  );
  if (blocking) return [blocking];
  const url = items.find((item) => item.label === "URL" || item.id.endsWith(":URL"));
  const pageChange = items.find((item) => isPageChange(item));
  if (url && pageChange) return [url, pageChange];
  const primary = items.find((item) => isPrimaryFollowUp(item));
  if (primary) return [primary];
  if (pageChange) return [pageChange];
  if (url) return [url];
  const photos = items.find((item) => isPhotoItem(item));
  if (photos) return [photos];
  const design = items.find((item) => item.id === "designNeeded");
  if (design) return [design];
  const other = items.find((item) => !isDateItem(item));
  if (other) return [other];
  const date = items.find((item) => item.id === "requestedCompletionDate" || item.id === "timing");
  if (date) return [date];
  return items[0] ? [items[0]] : [];
}

function isPageChange(item: MissingItem): boolean {
  return /page change|page copy|page headline/i.test(item.label);
}

function isPrimaryFollowUp(item: MissingItem): boolean {
  if (!item.id.startsWith("followup:")) return false;
  if (item.label === "URL" || isPageChange(item) || isPhotoItem(item)) return false;
  if (/what it replaces/i.test(item.label)) return false;
  return true;
}

function isPhotoItem(item: MissingItem): boolean {
  return item.id === "assets"
    || item.id === "menuPdf"
    || item.id.startsWith("attachment")
    || /photo|image|asset link|banner photo|organized assets/i.test(item.label);
}

function isDateItem(item: MissingItem): boolean {
  return item.id === "requestedCompletionDate" || item.id === "timing" || item.id === "consequenceOfDelay";
}

function joinAsk(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const head = parts[0].replace(/\?$/, "");
  const tail = parts[1].charAt(0).toLowerCase() + parts[1].slice(1);
  return `${head}, and ${tail.endsWith("?") ? tail : `${tail}?`}`;
}

function openingLine(draft: BriefDraft): string {
  const task = taskPhrase(draft.taskType);
  const place = draft.properties?.[0];
  const where = place
    ? draft.requestType === "Web" ? ` on the ${place} site` : ` for ${place}`
    : "";
  const purpose = purposePhrase(draft);
  return `Got it, ${task}${where}${purpose ? ` ${purpose}` : ""}.`;
}

function taskPhrase(task: string | undefined): string {
  if (task === "Page Edit") return "a page edit";
  if (task === "New Page") return "a new page";
  if (task === "Menu Upload") return "a menu upload";
  if (task === "Ad Refresh") return "an ad refresh";
  if (task === "Pop Up") return "a popup";
  if (task === "Happenings") return "an events update";
  if (!task) return "a request";
  const lower = task.toLowerCase();
  return /^[aeiou]/.test(lower) ? `an ${lower}` : `a ${lower}`;
}

function purposePhrase(draft: BriefDraft): string | undefined {
  const notes = (draft.notes ?? "").replace(/\s+/g, " ").trim();
  const ofPricing = notes.match(/\b(?:edit|update|change|updating|editing)\b(?:\s+\w+){0,8}?\s+pric(?:e|ing)\s+of\s+(?:the\s+)?(.+)/i);
  if (ofPricing?.[1]) {
    const subject = trimPlace(ofPricing[1]);
    if (subject) return `to update the ${subject} pricing`;
  }
  const name = (draft.requestName ?? "").replace(/\s+/g, " ").trim();
  if (/\bpric/i.test(`${notes} ${name}`)) {
    const cleaned = (name || notes)
      .replace(/\b(i want to|please|edit|update|change|updating|the|pricing|price|prices|at|on|for|website|site|page)\b/gi, " ")
      .replace(/\b(smb|smp|aup|sfp|ltp|dtla)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned && cleaned.length <= 40) return `to update the ${cleaned.toLowerCase()} pricing`;
    return "to update the pricing";
  }
  if (name && name.length <= 42) return `for ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
  return undefined;
}

function trimPlace(raw: string): string {
  return raw
    .replace(/\b(at|on|for)\b[\s\S]*$/i, "")
    .replace(/\b(website|site|page|homepage)\b/gi, "")
    .replace(/[?.!,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pageLinkQuestion(draft: BriefDraft): string {
  return draft.taskType === "Page Edit" ? "What's the link to the current page?" : "What's the link to the page?";
}

function changeQuestion(draft: BriefDraft): string {
  if (/\bpric/i.test(`${draft.notes ?? ""} ${draft.requestName ?? ""}`)) return "What should the new pricing text (copy) say?";
  return "What should the text (copy) say?";
}

function liveDateQuestion(draft: BriefDraft): string {
  const usual: Record<string, string> = {
    "Page Edit": "Page edits usually take about 3 working days.",
    "New Page": "New pages usually take about 10 working days.",
    Offers: "Offers usually take about 5 working days.",
    Happenings: "Events usually take about 1 working day.",
    "Menu Upload": "Menu updates usually take about 1 working day.",
  };
  const task = draft.taskType ?? "";
  if (usual[task]) return `When does it need to be live? ${usual[task]}`;
  if (leadTimeFor(draft).phrase === "This request uses a 7-day lead time") {
    return "When does it need to be live? This usually takes about 7 days.";
  }
  const phrase = leadTimeFor(draft).phrase
    .replace(/ need about /, " usually take about ")
    .replace(/ needs about /, " usually takes about ");
  const sentence = phrase.endsWith(".") ? phrase : `${phrase}.`;
  return `When does it need to be live? ${sentence}`;
}

function confirmKind(draft: BriefDraft): string {
  if (draft.taskType === "Page Edit" || draft.taskType === "New Page") return "website change";
  if (draft.taskType === "Menu Upload") return "menu change";
  if (draft.taskType === "Happenings") return "event";
  if (draft.requestType === "Social") return "social post";
  if (/email/i.test(draft.taskType ?? "")) return "email";
  if (draft.taskType === "Pop Up") return "popup";
  return "request";
}

function confirmSubject(draft: BriefDraft): string | undefined {
  const purpose = purposePhrase(draft);
  if (!purpose) return undefined;
  return purpose.replace(/^to update the /, "").replace(/^for /, "");
}

function shortDate(iso: string): string {
  return formatSpokenDate(iso).split(" ").slice(1).join(" ");
}

function taskTypeQuestion(draft: BriefDraft): string {
  if (draft.requestType === "Web") return "Is this a new page, a change to a page, a menu, or something else?";
  if (draft.requestType === "Social") return "Is this a feed post, a story, or something else?";
  if (draft.requestType === "CRM & Paid") return "Is this an email send, an ad, or something else?";
  if (draft.requestType === "Marketing") return "Is this an offer, or something else?";
  return "Is this an email, a social post, a menu, or something else?";
}

export { FILE_QUESTION, TEXT_QUESTION, CLICK_QUESTION, AUDIENCE_QUESTION, MESSAGE_LIMIT };

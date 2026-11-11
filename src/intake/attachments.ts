import { followUpsFor } from "./question-tree.js";
import {
  ATTACHMENT_KINDS,
  type AttachmentKind,
  type BriefDraft,
  type RequestAttachment,
} from "./types.js";

/**
 * Kinsey's four attachment kinds, in the order the bot offers them.
 * A menu or brochure that will be posted has to be an upload-ready PDF.
 */
export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  menu_or_brochure: "PDF of a menu or brochure to link onto a page",
  photo: "Photo needed for the page",
  page_content: "PDF of content to build as a page",
  context: "Context: a previous version of the asset, or a deck with background",
};

export const ATTACHMENT_KIND_HINT = [
  "• A PDF of a menu or brochure that needs to be linked onto a page",
  "• A photo needed for the page",
  "• A PDF of content that needs to be built as a page (for example, a sales group offer)",
  "• Context: a previous version of the asset, or a deck with background info",
].join("\n");

export const ATTACHMENT_PROVIDE_HINT =
  "Upload the file in this thread, or paste a Dropbox link or a link to the file already on the website.";

export const MENU_PDF_PATTERN = "Property_Outlet_MenuName_MonthYear";

export const ATTACHMENT_PROVIDE_ID = "attachmentProvide";

export type AttachmentAnswerResult = "recorded" | "need_pdf" | "unparsed";

export interface AttachmentInput {
  ref: string;
  kind?: string;
  fileName?: string;
  uploadReady?: boolean;
  pdfDeferred?: boolean;
}

const FILE_EXT = /\.(pdf|png|jpe?g|webp|gif|tiff?|ai|psd|zip|docx?|pptx?|xlsx?)(?:$|[?#])/i;
const GENERIC_PDF = /^(menu|menus|document|doc|untitled|file|download|scan|image|brochure|final|new)(?:\s*\(\d+\))?\.pdf$/i;
const URL_RE = /https?:\/\/[^\s<>]+/gi;

export function isAttachmentQuestion(id: string | undefined): boolean {
  return Boolean(id && (id === ATTACHMENT_PROVIDE_ID || id.startsWith("attachmentKind:") || id.startsWith("attachmentPdf:")));
}

export function attachmentKindFromText(text: string): AttachmentKind | undefined {
  const trimmed = text.trim().toLowerCase().replace(/[.!]+$/g, "");
  if (!trimmed) return undefined;
  if ((ATTACHMENT_KINDS as readonly string[]).includes(trimmed)) return trimmed as AttachmentKind;
  if (/^(1|a|option a)$/.test(trimmed)) return "menu_or_brochure";
  if (/^(2|b|option b)$/.test(trimmed)) return "photo";
  if (/^(3|c|option c)$/.test(trimmed)) return "page_content";
  if (/^(4|d|option d)$/.test(trimmed)) return "context";

  const hasMenu = /\b(menus?|brochures?)\b/.test(trimmed);
  const hasPhoto = /\b(photos?|images?|pictures?)\b/.test(trimmed);
  const hasPage = /built as a page|build as a page|page content|content to be built|sales group/.test(trimmed);
  const hasContext = /\bcontext\b|previous version|background info|background deck|\bdeck\b/.test(trimmed);
  if (hasPhoto && hasMenu && !/brochure|link onto a page|linked onto/.test(trimmed)) return "photo";
  if (hasPage && !hasMenu) return "page_content";
  if (hasMenu && !hasPhoto && !hasContext) return "menu_or_brochure";
  if (hasPhoto && !hasMenu && !hasPage && !hasContext) return "photo";
  if (hasContext && !hasMenu && !hasPhoto) return "context";
  if (hasPage) return "page_content";
  if (hasMenu) return "menu_or_brochure";
  if (hasContext) return "context";
  if (hasPhoto) return "photo";
  return undefined;
}

export function isFigmaBuzz(value: string): boolean {
  return /figma\s*buzz|figma\.com\/buzz|\.buzz(?:$|[?#\s])/i.test(value);
}

export function isDropbox(value: string): boolean {
  return /https?:\/\/(?:www\.)?dropbox\.com\//i.test(value);
}

export function isPdfRef(value: string): boolean {
  return FILE_EXT.test(value) && /\.pdf(?:$|[?#\s])/i.test(value.trim()) && !isFigmaBuzz(value);
}

export function requestHasFiles(draft: BriefDraft): boolean {
  if (draft.filesDeferred || draft.involvesFiles) return true;
  if (draft.requestType === "Web" && draft.taskType === "Menu Upload") return true;
  if ((draft.attachments ?? []).length > 0) return true;
  return explicitFileRefs(draft).length > 0;
}

export function viewAttachments(draft: BriefDraft): RequestAttachment[] {
  return mergeRefs(draft.attachments, explicitFileRefs(draft));
}

export function materializeAttachments(draft: BriefDraft): RequestAttachment[] {
  const next = viewAttachments(draft);
  draft.attachments = next;
  return next;
}

export function captureIncomingFiles(draft: BriefDraft, text: string, askedId?: string): void {
  if (askedId?.startsWith("attachmentKind:") || askedId?.startsWith("attachmentPdf:")) return;
  const refs = extractLooseFileRefs(text);
  if (/\b(dropbox|already on the (website|site)|figma\s*buzz)\b/i.test(text)) {
    for (const url of allUrls(text)) refs.push(url);
  }
  const uniqueRefs = dedupe(refs);
  if (uniqueRefs.length === 0) return;
  draft.involvesFiles = true;
  draft.attachments = mergeRefs(draft.attachments, uniqueRefs);
}

export function mergeAttachmentInputs(
  existing: RequestAttachment[] | undefined,
  inputs: AttachmentInput[],
): RequestAttachment[] {
  const next = (existing ?? []).map(cloneAttachment);
  for (const input of inputs) {
    const ref = input.ref.trim();
    if (!ref) continue;
    let found = next.find((item) => matchesRef(item, ref));
    if (!found) {
      found = { ref };
      next.push(found);
    }
    const kind = input.kind ? attachmentKindFromText(input.kind) : undefined;
    if (kind) found.kind = kind;
    if (input.fileName?.trim()) found.fileName = input.fileName.trim();
    if (input.uploadReady) found.uploadReady = true;
    if (input.pdfDeferred) found.pdfDeferred = true;
  }
  return next;
}

export function attachmentMissing(draft: BriefDraft): Array<{ id: string; label: string; hint?: string }> {
  if (!requestHasFiles(draft)) return [];
  const attachments = viewAttachments(draft);
  if (attachments.length === 0) {
    if (draft.filesDeferred) return [];
    return [{
      id: ATTACHMENT_PROVIDE_ID,
      label: "Upload or link for this file",
      hint: ATTACHMENT_PROVIDE_HINT,
    }];
  }
  const items: Array<{ id: string; label: string; hint?: string }> = [];
  attachments.forEach((attachment, index) => {
    if (!attachment.kind) {
      items.push({
        id: `attachmentKind:${index}`,
        label: `What kind of file is ${displayRef(attachment)}?`,
        hint: ATTACHMENT_KIND_HINT,
      });
    }
  });
  attachments.forEach((attachment, index) => {
    if (attachment.kind === "menu_or_brochure" && !pdfSatisfied(attachment)) {
      items.push({
        id: `attachmentPdf:${index}`,
        label: `Upload-ready PDF for ${displayRef(attachment)}`,
        hint: uploadReadyPdfPrompt(draft, attachment),
      });
    }
  });
  return items;
}

export function applyAttachmentAnswer(draft: BriefDraft, id: string, text: string): AttachmentAnswerResult {
  if (id === ATTACHMENT_PROVIDE_ID) {
    const refs = extractProvidedFileRefs(text);
    if (refs.length === 0) return "unparsed";
    draft.involvesFiles = true;
    delete draft.filesDeferred;
    draft.attachments = mergeRefs(draft.attachments, refs);
    return "recorded";
  }
  const attachments = materializeAttachments(draft);
  const kindMatch = id.match(/^attachmentKind:(\d+)$/);
  if (kindMatch) {
    const attachment = attachments[Number(kindMatch[1])];
    const kind = attachmentKindFromText(text);
    if (!attachment || !kind) return "unparsed";
    attachment.kind = kind;
    if (kind === "menu_or_brochure") {
      const pdf = pdfTokens(text).find((token) => !looksCombined(token));
      if (pdf) {
        attachment.ref = pdf;
        attachment.fileName = fileNameFromRef(pdf) ?? attachment.fileName;
        if (hasClearName(attachment, text)) attachment.uploadReady = true;
      }
    }
    draft.attachments = attachments;
    return "recorded";
  }
  const pdfMatch = id.match(/^attachmentPdf:(\d+)$/);
  if (!pdfMatch) return "unparsed";
  const attachment = attachments[Number(pdfMatch[1])];
  if (!attachment) return "unparsed";
  const result = applyPdfAnswer(attachment, text);
  draft.attachments = attachments;
  return result;
}

export function deferAttachmentAnswer(draft: BriefDraft, id: string): boolean {
  if (id === ATTACHMENT_PROVIDE_ID) {
    draft.filesDeferred = true;
    draft.involvesFiles = true;
    return true;
  }
  const pdf = id.match(/^attachmentPdf:(\d+)$/);
  if (!pdf) return false;
  const attachments = materializeAttachments(draft);
  const attachment = attachments[Number(pdf[1])];
  if (!attachment) return false;
  attachment.pdfDeferred = true;
  draft.attachments = attachments;
  return true;
}

export function clearAttachmentAnswer(draft: BriefDraft, id: string): boolean {
  if (id === ATTACHMENT_PROVIDE_ID) {
    delete draft.filesDeferred;
    draft.attachments = (draft.attachments ?? []).filter((item) => item.kind || item.uploadReady || item.pdfDeferred || item.slackFileId);
    return true;
  }
  const kind = id.match(/^attachmentKind:(\d+)$/);
  if (kind) {
    const attachment = draft.attachments?.[Number(kind[1])];
    if (attachment) delete attachment.kind;
    return true;
  }
  const pdf = id.match(/^attachmentPdf:(\d+)$/);
  if (pdf) {
    const attachment = draft.attachments?.[Number(pdf[1])];
    if (attachment) {
      delete attachment.uploadReady;
      delete attachment.pdfDeferred;
      delete attachment.fileName;
    }
    return true;
  }
  return false;
}

export function uploadReadyPdfPrompt(draft: BriefDraft, attachment: RequestAttachment): string {
  const example = suggestedPdfName(draft);
  const lines = [
    `*${displayRef(attachment)}* needs to be posted as a menu or brochure.`,
    `Send an upload-ready PDF, one menu per file, named clearly like ${example} (${MENU_PDF_PATTERN}).`,
    "The dev team can't use Figma Buzz files, so export a PDF first. If the file has two menus side by side, cut it down to one menu and give it a clear name.",
    "Upload it here, or paste a Dropbox link or a link to the PDF already on the website.",
    "If you truly can't export the PDF, reply *Let marketing recommend* and I'll flag it so marketing knows.",
  ];
  if (pdfReadyRef(attachment) && hasClearName(attachment, "") && !attachmentIsBuzz(attachment) && !attachmentIsCombined(attachment)) {
    lines.splice(1, 0, `If ${displayRef(attachment)} is already that PDF, reply yes.`);
  }
  return lines.join("\n");
}

export function suggestedPdfName(draft: BriefDraft): string {
  const property = draft.properties?.[0] ?? "Property";
  return `${property}_Outlet_MenuName_MonthYear`;
}

export function attachmentBriefLines(draft: BriefDraft): string[] {
  const attachments = draft.attachments ?? [];
  if (draft.filesDeferred && attachments.length === 0) {
    return ["Attachments: Let marketing recommend"];
  }
  const lines: string[] = [];
  const many = attachments.length > 1;
  attachments.forEach((attachment, index) => {
    const n = many ? ` ${index + 1}` : "";
    const kind = attachment.kind ? ATTACHMENT_KIND_LABELS[attachment.kind] : "Not specified";
    lines.push(`Attachment${n} type: ${kind}`);
    lines.push(`Attachment${n}: ${shownAttachment(attachment)}`);
    if (attachment.specs) lines.push(`Attachment${n} specs: ${attachment.specs}`);
    if (attachment.pdfDeferred) {
      lines.push(`Attachment${n} note: Not an upload-ready PDF. Flagged for marketing (Let marketing recommend).`);
    }
  });
  return lines;
}

export function attachmentAssetLines(draft: BriefDraft): string[] {
  return (draft.attachments ?? []).map((attachment) => {
    const kind = attachment.kind ? ATTACHMENT_KIND_LABELS[attachment.kind] : "Unspecified type";
    const flag = attachment.pdfDeferred ? " — flagged for marketing, not an upload-ready PDF" : "";
    const specs = attachment.specs ? `\n${attachment.specs}` : "";
    return `${kind}: ${shownAttachment(attachment)}${flag}${specs}`;
  });
}

function applyPdfAnswer(attachment: RequestAttachment, text: string): AttachmentAnswerResult {
  if (isFigmaBuzz(text) && pdfTokens(text).length === 0) return "need_pdf";
  const pdf = pdfTokens(text).find((token) => !looksCombined(token));
  const named = clearFileName(text);
  if (pdf) {
    attachment.ref = pdf;
    attachment.fileName = named ?? fileNameFromRef(pdf) ?? attachment.fileName;
    if (!hasClearName(attachment, text)) return "need_pdf";
    attachment.uploadReady = true;
    return "recorded";
  }
  if (isYes(text) || named) {
    if (named) attachment.fileName = named;
    if (attachmentIsBuzz(attachment) || attachmentIsCombined(attachment) || looksCombined(text)) return "need_pdf";
    if (!pdfReadyRef(attachment)) return "need_pdf";
    if (!hasClearName(attachment, text)) return "need_pdf";
    attachment.uploadReady = true;
    return "recorded";
  }
  return "unparsed";
}

function pdfSatisfied(attachment: RequestAttachment): boolean {
  if (attachment.pdfDeferred) return true;
  if (!attachment.uploadReady) return false;
  if (attachmentIsBuzz(attachment) || attachmentIsCombined(attachment)) return false;
  return pdfReadyRef(attachment) && hasClearName(attachment, "");
}

function pdfReadyRef(attachment: RequestAttachment): boolean {
  return attachmentFields(attachment).some((value) => isPdfRef(value) || isDropbox(value))
    || Boolean(attachment.fileName && isPdfRef(attachment.fileName));
}

function hasClearName(attachment: RequestAttachment, text: string): boolean {
  const candidate = clearFileName(text)
    || attachment.fileName
    || (attachment.name && /\.pdf$/i.test(attachment.name) ? attachment.name : undefined)
    || fileNameFromRef(attachment.ref ?? "")
    || fileNameFromRef(attachment.permalink ?? "");
  if (!candidate) return false;
  return !GENERIC_PDF.test(candidate);
}

function attachmentIsBuzz(attachment: RequestAttachment): boolean {
  return attachmentFields(attachment).some((value) => isFigmaBuzz(value));
}

function attachmentIsCombined(attachment: RequestAttachment): boolean {
  return attachmentFields(attachment).some((value) => looksCombined(value));
}

function attachmentFields(attachment: RequestAttachment): string[] {
  return [attachment.ref, attachment.name, attachment.fileName, attachment.permalink].filter((value): value is string => Boolean(value));
}

export function attachmentRef(attachment: RequestAttachment): string {
  return attachment.ref
    || attachment.permalink
    || attachment.fileName
    || attachment.name
    || (attachment.slackFileId ? `Slack file ${attachment.slackFileId}` : "attachment");
}

function shownAttachment(attachment: RequestAttachment): string {
  const ref = attachmentRef(attachment);
  const name = attachment.fileName || attachment.name;
  const named = name && normalizeRef(name) !== normalizeRef(ref) ? `${name} — ${ref}` : ref;
  if (attachment.permalink && !named.includes(attachment.permalink)) return `${named} — ${attachment.permalink}`;
  return named;
}

function explicitFileRefs(draft: BriefDraft): string[] {
  const refs: string[] = [];
  for (const asset of draft.assets ?? []) {
    if (looksLikeFile(asset)) refs.push(asset.trim());
  }
  if (draft.requestType && draft.taskType) {
    let fields: ReturnType<typeof followUpsFor> = [];
    try {
      fields = followUpsFor(draft.requestType, draft.taskType);
    } catch {
      fields = [];
    }
    for (const field of fields) {
      if (!field.satisfies?.includes("assets")) continue;
      const value = draft.followUps?.[field.label]?.trim();
      if (value && looksLikeFile(value)) refs.push(value);
    }
  }
  return refs;
}

function looksLikeFile(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /^let marketing recommend[.!]?$/i.test(trimmed)) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (FILE_EXT.test(trimmed)) return true;
  if (isFigmaBuzz(trimmed)) return true;
  return false;
}

export function extractLooseFileRefs(text: string): string[] {
  const refs = fileNamesFromNote(text);
  for (const url of allUrls(text)) {
    if (isDropbox(url) || isFigmaBuzz(url) || /figma\.com/i.test(url) || FILE_EXT.test(url)) refs.push(url);
  }
  if (isFigmaBuzz(text) && !refs.some((ref) => isFigmaBuzz(ref))) refs.push("Figma Buzz file");
  return refs;
}

export function extractProvidedFileRefs(text: string): string[] {
  const refs = extractLooseFileRefs(text);
  for (const url of allUrls(text)) {
    if (!refs.some((ref) => normalizeRef(ref) === normalizeRef(url))) refs.push(url);
  }
  const bare = text.trim();
  if (refs.length === 0 && /^[\w .()-]+\.(pdf|png|jpe?g|webp|gif)$/i.test(bare)) refs.push(bare);
  return refs;
}

function mergeRefs(existing: RequestAttachment[] | undefined, refs: string[]): RequestAttachment[] {
  const next = (existing ?? []).map(cloneAttachment);
  for (const ref of refs) {
    const clean = trimUrl(ref.trim());
    if (!clean) continue;
    if (next.some((item) => matchesRef(item, clean))) continue;
    next.push({ ref: clean });
  }
  return next;
}

function pdfTokens(text: string): string[] {
  const found: string[] = [];
  for (const url of allUrls(text)) {
    if (isPdfRef(url)) found.push(url);
  }
  for (const match of text.matchAll(/\b[\w.-]+\.pdf\b/gi)) {
    if (isPdfRef(match[0]) && !found.some((item) => normalizeRef(item) === normalizeRef(match[0]))) found.push(match[0]);
  }
  return found;
}

function clearFileName(text: string): string | undefined {
  const match = text.match(/\b([A-Za-z0-9]+(?:_[A-Za-z0-9]+){2,}(?:\.pdf)?)\b/);
  if (!match) return undefined;
  return /\.pdf$/i.test(match[1]) ? match[1] : `${match[1]}.pdf`;
}

function fileNameFromRef(ref: string): string | undefined {
  const match = ref.match(/([^/?#]+\.pdf)/i);
  return match?.[1];
}

function looksCombined(value: string): boolean {
  const flat = value.replace(/[_-]+/g, " ");
  return /side\s*by\s*side|two menus|2 menus|both menus|double menu/i.test(flat);
}

function isYes(text: string): boolean {
  return /^(yes|yep|yeah|yup|it is|that's the one|thats the one|use this|this is it|already is|it's ready|its ready)[.!]?$/i.test(text.trim());
}

function displayRef(attachment: RequestAttachment): string {
  const value = attachment.fileName || attachment.name || attachmentRef(attachment);
  if (value.length <= 80) return value;
  return `${value.slice(0, 77)}…`;
}

function allUrls(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((match) => trimUrl(match[0]));
}

function fileNamesFromNote(text: string): string[] {
  const match = text.match(/(?:^|\n)Files:\s*(.+)$/i);
  if (!match) return [];
  return match[1].split(",").map((part) => part.trim()).filter(Boolean);
}

function trimUrl(url: string): string {
  return url.replace(/[),.;>]+$/g, "");
}

function normalizeRef(ref: string): string {
  return trimUrl(ref).trim().toLowerCase();
}

function matchesRef(item: RequestAttachment, ref: string): boolean {
  const key = normalizeRef(ref);
  if (!key) return false;
  for (const value of [item.ref, item.permalink, item.name, item.fileName, item.slackFileId]) {
    if (value && normalizeRef(value) === key) return true;
  }
  return Boolean(item.slackFileId && key.includes(item.slackFileId.toLowerCase()));
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalizeRef(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(trimUrl(value.trim()));
  }
  return result;
}

function cloneAttachment(attachment: RequestAttachment): RequestAttachment {
  return { ...attachment };
}

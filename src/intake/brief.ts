import { fieldQuestion, friendlyRecap, naturalAck } from "./ask-text.js";
import { greet } from "../slack/mentions.js";
import { formatRequestTypeChoices, formatTaskTypeChoices } from "./choices.js";
import { applyDefaultApprover, formatDisplayDate, formatFullDate, normalizeDate, routingSignOff, secondContact, signOffFor } from "./catalog.js";
import { PRICE_PENDING_LINE, type MissingItem } from "./missing.js";
import { followUpsFor, SUPPORT_QUESTION } from "./question-tree.js";
import type { TemplateMatchResult } from "./templates.js";
import { taskName } from "./task-name.js";
import type { BriefDraft, FollowUp } from "./types.js";
import { exactAnswer } from "./urls.js";

export { taskName };

export function slackThreadUrl(channel: string, threadTs: string): string {
  const parent = threadTs.replace(".", "");
  return `https://slack.com/archives/${channel}/p${parent}`;
}

export function buildDescription(input: {
  draft: BriefDraft;
  templateOffer: TemplateMatchResult | null;
  slackThread?: string;
}): string {
  const { draft } = input;
  applyDefaultApprover(draft);
  const support = draft.requestType ? SUPPORT_QUESTION[draft.requestType] : "What type of support do you need?";
  const signOff = signOffFor(draft);
  const templateLine = canvaTemplateLine(draft, input.templateOffer);
  const pending = [
    ...(draft.pricePending ? [PRICE_PENDING_LINE] : []),
    ...(draft.skipped ?? []).map((entry) => `${entry.label}: Not sure (requester will provide)`),
    ...pdfFlagLines(draft),
  ];
  const lines = [
    ...formPair("Name", draft.requesterName),
    ...formPair("Email address", draft.requesterEmail),
    ...formPair("Original requester", draft.originalRequester),
    ...formPair("Forwarded by", draft.forwardedBy),
    ...formPair("Email subject", draft.emailSubject),
    ...formPair("Request Name", draft.requestName),
    ...formPair("Property", (draft.properties ?? []).join(", ")),
    ...formPair("Requested Completion Date", draft.requestedCompletionDate ? formatDisplayDate(draft.requestedCompletionDate) : undefined),
    ...formPair("Consequence of Delay", exactAnswer(draft.consequenceOfDelay ?? "")),
    ...formPair("What can we help you with?", draft.requestType),
    ...formPair(support, draft.taskType),
    ...formAnswerLines(draft),
    ...(draft.rushApprovedBy ? [`Rush approved by ${draft.rushApprovedBy}`, ""] : []),
    ...(templateLine ? [templateLine, ""] : []),
    "## Pending from requester",
    pending.join("\n") || "(none)",
    "",
    ...formPair("Approver", draft.approver),
    ...formPair("Sign-off", signOff),
    ...(draft.alsoNotify?.length ? [`Also notify: ${draft.alsoNotify.join(", ")}`, ""] : []),
    "———————————————",
    `Drafted from Slack: ${input.slackThread ?? ""}`,
  ];
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function formatQuestions(input: {
  userId?: string;
  items: MissingItem[];
  warnings: string[];
  draft: BriefDraft;
  acknowledge?: boolean;
  /** What was already captured when only half of a combined question remains. */
  captured?: string;
  /** Replaces the @mention when the person to ask is known by name only. */
  who?: string;
  /** First question only. Later questions stay short. */
  offerHelp?: boolean;
  /** Field just answered, so the acknowledgement can name it. */
  ackFor?: string;
}): string {
  const item = input.items[0];
  if (!item) return "";
  const question = fieldQuestion(item, input.draft);
  const lines: string[] = [];
  if (input.acknowledge) lines.push(naturalAck({ lastId: input.ackFor, draft: input.draft }), "");
  if (input.captured) lines.push(input.captured, "");
  if (!input.acknowledge && (input.userId || input.who)) {
    lines.push(`${greet({ userId: input.userId, name: input.who })} ${question}`);
  } else lines.push(question);
  const choices = choiceList(item.id, input.draft.requestType);
  if (choices) lines.push("", choices);
  else if (item.hint && !item.hint.startsWith("One or more of") && item.id !== "properties") lines.push(item.hint);
  if (input.warnings.length > 0) {
    lines.push("", ...input.warnings.map((warning) => `• ${warning}`));
  }
  if (input.offerHelp) {
    const contact = secondContact(input.draft.properties ?? []);
    lines.push("", `If you don't have it, say skip or not sure and ${contact} may know. Say back to change your last answer.`);
  }
  return lines.join("\n");
}

export function formatPropertyQuestion(userId?: string, who?: string): string {
  return `${greet({ userId, name: who })} Which property is this for? A code like SMP or LTP is perfect. I check for a template before asking for the rest.`;
}

export function formatTemplateOffer(result: TemplateMatchResult): string {
  if (result.matches.length === 0) return "";
  if (result.duplicateName) {
    const name = result.matches[0].name;
    return [
      `There are two Canva templates both named *${name}*. I don't know which file is the right one, so here are both:`,
      ...result.matches.map((match) => `• ${match.name}: ${match.url}`),
      "You can make this yourself from either template.",
      "If neither fits — you don't like them, they don't match, or you want the team to design it — say so and I'll collect the full brief. I'll note which templates were offered and why they weren't used.",
    ].join("\n");
  }
  if (result.matches.length === 1) {
    const match = result.matches[0];
    return [
      `There's a Canva template for this: *${match.name}* (${match.useFor}).`,
      match.url,
      "You can make it yourself from that template.",
      "If it doesn't fit, you don't like it, or you want the team to design it, say so and I'll collect the full brief. I'll note that this template was offered and why it wasn't used.",
    ].join("\n");
  }
  return [
    "More than one Canva template fits. You can make this yourself from one of these:",
    ...result.matches.map((match) => `• ${match.name} (${match.useFor}): ${match.url}`),
    "If none of them fit, or you want the team to design it, say so and I'll collect the full brief.",
  ].join("\n");
}

export function formatSummary(input: {
  draft: BriefDraft;
  warnings: string[];
  templateOffer: TemplateMatchResult | null;
  duplicates: Array<{ name: string; url?: string }>;
}): string {
  const { draft } = input;
  applyDefaultApprover(draft);
  const lines = [
    friendlyRecap(draft),
    "",
    `Task name: *${taskName(draft)}*`,
    "Tell me if this name should change.",
    `${draft.requestType} → ${draft.taskType}`,
    `Requester: ${draft.requesterName} (${draft.requesterEmail})`,
    ...(draft.originalRequester ? [`Original requester: ${draft.originalRequester}`] : []),
    ...(draft.forwardedBy ? [`Forwarded by: ${draft.forwardedBy}`] : []),
    ...(draft.emailSubject ? [`Email subject: ${draft.emailSubject}`] : []),
    `Property: ${(draft.properties ?? []).join(", ")}`,
    `Requested: ${draft.requestedCompletionDate ? formatDisplayDate(draft.requestedCompletionDate) : ""}`,
    `If it's late: ${draft.consequenceOfDelay ? exactAnswer(draft.consequenceOfDelay) : ""}`,
    `Approver: ${draft.approver ?? signOffFor(draft)}`,
    ...goesLiveLine(draft),
  ];
  const signOff = routingSignOff(draft.properties ?? []);
  if (signOff.bucket && signOff.bucket !== "Mixed") {
    lines.push(`Routing bucket: ${signOff.bucket}`);
  } else if (signOff.bucket === "Mixed") {
    lines.push("Properties span more than one routing bucket. The board will sort that out.");
  }
  lines.push(`Sign-off: ${signOffFor(draft)}`);
  if (draft.requestType && draft.taskType) {
    for (const field of followUpsFor(draft.requestType, draft.taskType)) {
      const value = shownFollowUp(draft, field);
      if (!value) continue;
      lines.push(`${field.label}: ${value}`);
    }
  }
  if (draft.copyReady === false && draft.copyOwner) {
    lines.push(`Copy writer: ${draft.copyOwner}${draft.copyDueDate ? ` by ${draft.copyDueDate}` : ""}`);
  }
  if (draft.designNeeded === true) lines.push("Design needed: yes");
  if (draft.designNeeded === false) lines.push("Design needed: no");
  if ((draft.alsoNotify ?? []).length > 0) lines.push(`Also notify: ${draft.alsoNotify?.join(", ")}`);
  const attachments = attachmentNames(draft);
  if (attachments.length > 0) lines.push(`Attachments: ${attachments.join(", ")}`);
  const offer = input.templateOffer;
  if (offer && offer.matches.length > 0) {
    lines.push(
      `Template offered: ${offer.matches.map((match) => match.name).join(", ")}`,
    );
    if (draft.templateUnusedReason) lines.push(`Not used: ${draft.templateUnusedReason}`);
  }
  if (draft.pricePending) {
    lines.push(PRICE_PENDING_LINE);
    lines.push("Price is still pending. Reply in the Asana task or in this thread with the price when you have it.");
  }
  if (input.warnings.length > 0) {
    lines.push("", ...input.warnings.map((warning) => `• ${warning}`));
  }
  if (input.duplicates.length > 0) {
    lines.push("", "Possible existing task:");
    for (const duplicate of input.duplicates) {
      lines.push(`• ${duplicate.name}${duplicate.url ? ` — ${duplicate.url}` : ""}`);
    }
    lines.push("Confirm still creates a new task. Say if you want a note on the existing one instead.");
  }
  return lines.join("\n");
}

export function formatTemplateAccepted(result: TemplateMatchResult): string {
  const links = result.matches.map((match) => `${match.name}: ${match.url}`).join("\n");
  return `Use the template and you don't need a task.\n${links}\nIf you later want the team to design it, say so and I'll collect the brief.`;
}

function formPair(label: string, value: string | undefined): string[] {
  const text = value?.trim();
  if (!text) return [];
  const heading = label.endsWith(":") ? label : `${label}:`;
  return [heading, text, ""];
}

function goesLiveLine(draft: BriefDraft): string[] {
  const live = placeName(draft.whereItGoesLive) ?? placeName(followUpDestination(draft));
  return live ? [`Goes live: ${live}`] : [];
}

function placeName(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text || /https?:\/\//i.test(text)) return undefined;
  return text;
}

function attachmentNames(draft: BriefDraft): string[] {
  const names: string[] = [];
  for (const file of draft.attachments ?? []) {
    const name = file.name || file.fileName || fileNameOf(file.ref) || fileNameOf(file.permalink);
    if (!name || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

function fileNameOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed) && /slack\.com\/files/i.test(trimmed) && !/\.[a-z0-9]{2,5}(?:$|\?)/i.test(trimmed)) {
    return undefined;
  }
  const last = trimmed.split("?")[0]?.split("/").pop();
  if (!last || last.length > 180) return undefined;
  return decodeURIComponentSafe(last);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function choiceList(itemId: string, requestType: BriefDraft["requestType"]): string | undefined {
  if (itemId === "requestType") return formatRequestTypeChoices();
  if (itemId === "taskType" && requestType) return formatTaskTypeChoices(requestType);
  return undefined;
}

function followUpDestination(draft: BriefDraft): string | undefined {
  if (!draft.requestType || !draft.taskType) return undefined;
  for (const field of followUpsFor(draft.requestType, draft.taskType)) {
    if (field.satisfies?.includes("destination") && draft.followUps?.[field.label]) {
      return draft.followUps[field.label];
    }
  }
  return undefined;
}

function formAnswerLines(draft: BriefDraft): string[] {
  if (!draft.requestType || !draft.taskType) return [];
  const lines: string[] = [];
  const skipped = new Set((draft.skipped ?? []).map((entry) => entry.label));
  for (const field of followUpsFor(draft.requestType, draft.taskType)) {
    const value = shownFollowUp(draft, field);
    if (value) lines.push(...formPair(field.label, value));
    else if (!field.required && !skipped.has(field.label)) lines.push(...formPair(field.label, "N/A"));
  }
  return lines;
}

function shownFollowUp(draft: BriefDraft, field: FollowUp): string | undefined {
  const stored = draft.followUps?.[field.label]?.trim();
  const copy = field.satisfies?.includes("copy") ? draft.finalCopy?.trim() : undefined;
  const value = stored || copy;
  if (!value) return undefined;
  return renderRequesterAnswer(field.kind, value);
}

function pdfFlagLines(draft: BriefDraft): string[] {
  return (draft.attachments ?? [])
    .filter((file) => file.pdfDeferred)
    .map((file) => `${file.name || file.fileName || file.ref || "Attachment"}: Not an upload-ready PDF. Flagged for marketing (Let marketing recommend).`);
}

function canvaTemplateLine(draft: BriefDraft, offer: TemplateMatchResult | null): string | undefined {
  if (!offer || offer.matches.length === 0) return undefined;
  const offered = offer.matches.map((match) => `${match.name} ${match.url}`).join("; ");
  const reason = draft.templateUnusedReason?.trim();
  return reason ? `Canva template offered: ${offered}. Not used: ${reason}.` : `Canva template offered: ${offered}.`;
}

function renderRequesterAnswer(kind: string, value: string): string {
  const trimmed = exactAnswer(value);
  if (kind === "date" || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const iso = normalizeDate(trimmed);
    if (iso && iso === trimmed) return formatFullDate(iso);
  }
  return trimmed;
}


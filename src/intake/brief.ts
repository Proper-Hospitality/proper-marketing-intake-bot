import { formatRequestTypeChoices, formatTaskTypeChoices } from "./choices.js";
import { expectedRoutingBucket, formatDisplayDate, formatFullDate, FORM_URL, normalizeDate, propertyNames, secondContact } from "./catalog.js";
import { PRICE_PENDING_LINE, type MissingItem } from "./missing.js";
import { followUpsFor, SUPPORT_QUESTION } from "./question-tree.js";
import type { TemplateMatchResult } from "./templates.js";
import type { BriefDraft } from "./types.js";

export function taskName(draft: BriefDraft): string {
  const properties = (draft.properties ?? []).join(", ");
  return `${properties}, ${draft.requestName ?? ""}`.trim();
}

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
  const properties = (draft.properties ?? []).join(", ");
  const date = draft.requestedCompletionDate ? formatDisplayDate(draft.requestedCompletionDate) : "";
  const followUps = draft.requestType && draft.taskType ? followUpsFor(draft.requestType, draft.taskType) : [];
  const briefLines = briefAnswerLines(draft);
  const templateLine = canvaTemplateLine(draft, input.templateOffer);
  const pending = draft.pricePending ? [PRICE_PENDING_LINE] : [];

  const assetLines = [
    ...(draft.assets ?? []),
    ...followUps
      .filter((field) => field.satisfies?.includes("assets") && draft.followUps?.[field.label])
      .map((field) => draft.followUps?.[field.label] as string),
  ];
  if (draft.assetsOwner) {
    assetLines.push(`Coming from ${draft.assetsOwner}${draft.assetsDue ? ` by ${draft.assetsDue}` : ""}`);
  }

  const support = draft.requestType ? SUPPORT_QUESTION[draft.requestType] : "What type of support do you need?";

  return [
    "Name:",
    draft.requesterName ?? "",
    "",
    "Email address:",
    draft.requesterEmail ?? "",
    "",
    "Request Name:",
    draft.requestName ?? "",
    "",
    "Property:",
    properties,
    "",
    "Requested Completion Date:",
    date,
    "",
    "Consequence of Delay:",
    draft.consequenceOfDelay ?? "",
    "",
    "What can we help you with?:",
    draft.requestType ?? "",
    "",
    `${support}:`,
    draft.taskType ?? "",
    "",
    "## Brief",
    briefLines.join("\n") || "(none)",
    "",
    ...(templateLine ? [templateLine, ""] : []),
    "## Pending from requester",
    pending.join("\n") || "(none)",
    "",
    "## Assets",
    unique(assetLines).join("\n") || "(none)",
    "",
    "## Approver",
    draft.approver ?? "",
    "",
    "———————————————",
    `Drafted from Slack: ${input.slackThread ?? ""}`,
  ].join("\n");
}

export function formatQuestions(input: {
  userId?: string;
  items: MissingItem[];
  warnings: string[];
  draft: BriefDraft;
}): string {
  const who = input.userId ? `<@${input.userId}>` : "Hi";
  const contact = secondContact(input.draft.properties ?? []);
  const lines = [
    `${who} — I need the following before this can be filed. Answer in one reply. If you don't know, ${contact} may.`,
    "",
  ];
  input.items.forEach((item, index) => {
    const choices = choiceList(item.id, input.draft.requestType);
    if (choices) {
      lines.push(`${index + 1}. *${item.label}*`);
      lines.push(choices);
      return;
    }
    const hint = item.hint ? ` — ${item.hint}` : "";
    lines.push(`${index + 1}. *${item.label}*${hint}`);
  });
  if (input.warnings.length > 0) {
    lines.push("", ...input.warnings.map((warning) => `• ${warning}`));
  }
  lines.push("", nextStepLine(input.draft));
  return lines.join("\n");
}

export function formatPropertyQuestion(userId?: string): string {
  const who = userId ? `<@${userId}>` : "Hi";
  return [
    `${who} — which property is this for? A property-specific Canva template may fit, so I want to check that before asking for the rest.`,
    `Reply with one or more of: ${propertyNames().join(", ")}.`,
  ].join("\n");
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
  const lines = [
    "Nothing is filed until you click *Confirm*.",
    "",
    `*${taskName(draft)}*`,
    `${draft.requestType} → ${draft.taskType}`,
    `Requester: ${draft.requesterName} (${draft.requesterEmail})`,
    `Property: ${(draft.properties ?? []).join(", ")}`,
    `Requested: ${draft.requestedCompletionDate ? formatDisplayDate(draft.requestedCompletionDate) : ""}`,
    `If it's late: ${draft.consequenceOfDelay ?? ""}`,
    `Approver: ${draft.approver ?? ""}`,
    `Goes live: ${draft.whereItGoesLive ?? followUpDestination(draft) ?? ""}`,
  ];
  const bucket = expectedRoutingBucket(draft.properties ?? []);
  if (bucket && bucket !== "Mixed") {
    lines.push(`Routing bucket (set by the board, not by me): ${bucket}`);
  } else if (bucket === "Mixed") {
    lines.push("Properties span more than one routing bucket. The board will sort that out.");
  }
  if (draft.requestType && draft.taskType) {
    for (const field of followUpsFor(draft.requestType, draft.taskType)) {
      const value = draft.followUps?.[field.label];
      if (!value) continue;
      lines.push(`${field.label}: ${truncate(value, 500)}`);
    }
  }
  if ((draft.assets ?? []).length > 0) lines.push(`Assets: ${(draft.assets ?? []).join(", ")}`);
  if (draft.finalCopy) lines.push(`Copy: ${truncate(draft.finalCopy, 500)}`);
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
  lines.push("", `Prefer the form? ${FORM_URL}`);
  return lines.join("\n");
}

export function formatTemplateAccepted(result: TemplateMatchResult): string {
  const links = result.matches.map((match) => `${match.name}: ${match.url}`).join("\n");
  return `Use the template and you don't need a task.\n${links}\nIf you later want the team to design it, say so and I'll collect the brief. Form, if you'd rather fill it yourself: ${FORM_URL}`;
}

function choiceList(itemId: string, requestType: BriefDraft["requestType"]): string | undefined {
  if (itemId === "requestType") return formatRequestTypeChoices();
  if (itemId === "taskType" && requestType) return formatTaskTypeChoices(requestType);
  return undefined;
}

function nextStepLine(draft: BriefDraft): string {
  if (draft.requestType && draft.taskType) {
    return `Once these are answered, this goes into Asana as ${draft.requestType} → ${draft.taskType} and you'll get the link here.`;
  }
  return "Once these are answered, I'll either point you at a Canva template or finish the brief for Asana.";
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

function briefAnswerLines(draft: BriefDraft): string[] {
  if (!draft.requestType || !draft.taskType) return [];
  const lines: string[] = [];
  for (const field of followUpsFor(draft.requestType, draft.taskType)) {
    const value = draft.followUps?.[field.label];
    if (!value?.trim()) continue;
    lines.push(`${field.label}: ${renderRequesterAnswer(field.kind, value)}`);
  }
  if (draft.finalCopy?.trim()) lines.push(`Final copy: ${draft.finalCopy.trim()}`);
  if (draft.copyOwner?.trim()) {
    const due = draft.copyDueDate ? normalizeDate(draft.copyDueDate) : undefined;
    lines.push(`Copy owner: ${draft.copyOwner.trim()}${due ? ` (due ${formatFullDate(due)})` : ""}`);
  }
  return lines;
}

function canvaTemplateLine(draft: BriefDraft, offer: TemplateMatchResult | null): string | undefined {
  if (!offer || offer.matches.length === 0) return undefined;
  const offered = offer.matches.map((match) => `${match.name} ${match.url}`).join("; ");
  const reason = draft.templateUnusedReason?.trim();
  return reason ? `Canva template offered: ${offered}. Not used: ${reason}.` : `Canva template offered: ${offered}.`;
}

function renderRequesterAnswer(kind: string, value: string): string {
  const trimmed = value.trim();
  if (kind === "date" || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const iso = normalizeDate(trimmed);
    if (iso) return formatFullDate(iso);
  }
  return trimmed;
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

import { daysUntil, propertyNames, taskTypeNames } from "./catalog.js";
import { followUpsFor, SUPPORT_QUESTION } from "./question-tree.js";
import { REQUEST_TYPES, type BriefDraft, type FollowUp, type RequestType } from "./types.js";

export interface MissingItem {
  id: string;
  label: string;
  hint?: string;
  verbatim?: boolean;
}

export interface MissingReport {
  items: MissingItem[];
  warnings: string[];
}

const PLACEHOLDER = /^(tbd|n\/a|na|asap|pending|coming soon|idk|unsure|unknown|\?|none yet|not sure)$/i;

export function isFilled(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (PLACEHOLDER.test(trimmed)) return false;
  return true;
}

export function listMissing(draft: BriefDraft, today = new Date()): MissingReport {
  const items: MissingItem[] = [];
  const warnings: string[] = [];

  if (!isFilled(draft.requesterName)) {
    items.push({ id: "requesterName", label: "Your name", hint: "The person this request is for." });
  }
  if (!isFilled(draft.requesterEmail)) {
    items.push({
      id: "requesterEmail",
      label: "Your email",
      hint: "Needed on the intake task. Slack didn't share one, so send it here.",
    });
  }
  if (!isFilled(draft.requestName)) {
    items.push({
      id: "requestName",
      label: "Request name",
      hint: "Short and specific, without the property name. The task title adds the property.",
    });
  }
  if (!draft.properties || draft.properties.length === 0) {
    items.push({
      id: "properties",
      label: "Property",
      hint: `One or more of: ${propertyNames().join(", ")}.`,
    });
  }

  if (!draft.requestType) {
    items.push({
      id: "requestType",
      label: "What can we help you with?",
      hint: REQUEST_TYPES.join(", ") + ". Start with Creative for most new design. Offers go to Marketing. Quick edits can go straight to Web, CRM & Paid, or Social.",
    });
    return { items, warnings };
  }

  if (!draft.taskType) {
    items.push({
      id: "taskType",
      label: SUPPORT_QUESTION[draft.requestType],
      hint: taskTypeNames(draft.requestType).join(", "),
    });
    return { items, warnings };
  }

  const followUps = followUpsFor(draft.requestType, draft.taskType);
  for (const field of followUps) {
    if (!field.required) continue;
    if (isFilled(draft.followUps?.[field.label])) continue;
    items.push(missingFollowUp(field));
  }

  if (!draft.requestedCompletionDate) {
    items.push({
      id: "requestedCompletionDate",
      label: "Requested completion date",
      hint: "A real date, not ASAP. Ideally at least 7 days out.",
    });
  } else {
    const days = daysUntil(draft.requestedCompletionDate, today);
    if (days < 0) {
      warnings.push(
        `The requested date ${draft.requestedCompletionDate} is already past. Say if you still want this filed.`,
      );
    } else if (days < 7) {
      warnings.push(
        `${draft.requestedCompletionDate} is inside the 7-day lead time (${days} day${days === 1 ? "" : "s"} out). Consequence of delay is what gets it prioritized.`,
      );
    }
  }

  if (!isFilled(draft.consequenceOfDelay)) {
    items.push({
      id: "consequenceOfDelay",
      label: "Consequence of delay",
      hint: "One line on what is lost if this is late.",
    });
  }

  if (!copySatisfied(draft, followUps)) {
    items.push({
      id: "copy",
      label: "Final copy, or who is writing it and when it's due",
      hint: "Paste the final copy, or name the owner and the date. TBD alone is not enough.",
    });
  }

  if (!assetsSatisfied(draft, followUps)) {
    items.push({
      id: "assets",
      label: "Assets",
      hint: "A Brandfolder, Dropbox, Drive, or Slack link to the original file. A photo of a menu or a screenshot inside a deck doesn't count. If the file isn't ready, name who will deliver it and the date.",
    });
  }

  if (!isFilled(draft.approver)) {
    items.push({ id: "approver", label: "Final approver", hint: "One named person who signs off." });
  }

  if (!destinationSatisfied(draft, followUps)) {
    items.push({
      id: "whereItGoesLive",
      label: "Where it goes live",
      hint: "A URL, channel, or handle.",
    });
  }

  for (const field of followUps) {
    if (field.kind !== "date") continue;
    const value = draft.followUps?.[field.label];
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
    if (daysUntil(value, today) < 0) {
      warnings.push(`${field.label} (${value}) is already past.`);
    }
  }

  return { items, warnings };
}

function missingFollowUp(field: FollowUp): MissingItem {
  const hints: string[] = [];
  if (field.verbatim) hints.push("Use the exact text. Don't paraphrase, and don't invent codes or links.");
  if (field.kind === "number") hints.push("A number.");
  if (field.kind === "date") hints.push("A real date.");
  if (field.options) hints.push(`Options: ${field.options.join(", ")}.`);
  return {
    id: `followup:${field.label}`,
    label: field.label,
    hint: hints.join(" ") || undefined,
    verbatim: field.verbatim,
  };
}

function copySatisfied(draft: BriefDraft, followUps: FollowUp[]): boolean {
  if (followUps.some((field) => field.required && field.satisfies?.includes("copy"))) return true;
  if (followUps.some((field) => field.satisfies?.includes("copy") && isFilled(draft.followUps?.[field.label]))) {
    return true;
  }
  if (isFilled(draft.finalCopy)) return true;
  return isFilled(draft.copyOwner) && isFilled(draft.copyDueDate);
}

function assetsSatisfied(draft: BriefDraft, followUps: FollowUp[]): boolean {
  if (followUps.some((field) => field.required && field.satisfies?.includes("assets"))) return true;
  if ((draft.assets ?? []).some((asset) => isFilled(asset))) return true;
  if (followUps.some((field) => field.satisfies?.includes("assets") && isFilled(draft.followUps?.[field.label]))) {
    return true;
  }
  return isFilled(draft.assetsOwner) && isFilled(draft.assetsDue);
}

function destinationSatisfied(draft: BriefDraft, followUps: FollowUp[]): boolean {
  if (followUps.some((field) => field.required && field.satisfies?.includes("destination"))) return true;
  if (isFilled(draft.whereItGoesLive)) return true;
  return followUps.some((field) => field.satisfies?.includes("destination") && isFilled(draft.followUps?.[field.label]));
}

export function isReadyToConfirm(draft: BriefDraft, today = new Date()): boolean {
  return listMissing(draft, today).items.length === 0 && Boolean(draft.requestType && draft.taskType);
}

import { attachmentMissing, requestHasFiles } from "./attachments.js";
import { daysUntil, propertyNames, taskTypeNames } from "./catalog.js";
import { leadTimeFor, leadTimeIsTight, leadTimeSentence } from "./lead-time.js";
import { configuredReviewer } from "../review/config.js";
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

export const PRICE_PENDING_LINE = "Price: TBD (requester will provide)";

const PRICE_WORD = /\b(prices?|pricing|costs?)\b/i;

/** The requester said the price, pricing, or cost is not ready. Other topics do not match. */
export function isPricePendingStatement(value: string | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text || !PRICE_WORD.test(text)) return false;
  return /(?:don'?t|do not|dont)\s+have|no\s+(?:price|pricing|cost)|tbd|pending|not ready|not yet|not final|waiting|later|will send|send later|coming soon/i.test(text);
}

export function mentionsActualPrice(value: string | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text || isPricePendingStatement(text)) return false;
  return /\$\s?\d|\b\d+(?:\.\d{2})?\s*(?:dollars|usd)\b/i.test(text);
}

export function isPriceOnlyField(label: string): boolean {
  if (!PRICE_WORD.test(label)) return false;
  const rest = label
    .replace(PRICE_WORD, " ")
    .replace(/\b(and|with|the|a|an|item|of|for|&)\b/gi, " ")
    .replace(/[^a-z]+/gi, " ")
    .trim();
  return rest.length === 0;
}

export function isOnlyPricePending(value: string | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text) return false;
  const parts = text.split(/[\n.;]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => PLACEHOLDER.test(part) || isPricePendingStatement(part)) && parts.some((part) => isPricePendingStatement(part));
}

export function followUpAnswerCounts(field: FollowUp, value: string | undefined, pricePending: boolean): boolean {
  if (isPriceOnlyField(field.label)) {
    if (pricePending || isPricePendingStatement(value) || (value && PLACEHOLDER.test(value.trim()))) return true;
    return isFilled(value);
  }
  if (!isFilled(value)) return false;
  if (isOnlyPricePending(value)) return false;
  return true;
}

export function isFilled(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (PLACEHOLDER.test(trimmed)) return false;
  return true;
}

export function listMissing(draft: BriefDraft, today = new Date()): MissingReport {
  applyConfiguredApprover(draft);
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
    return { items: presentQuestions(draft, items, []), warnings };
  }

  if (!draft.taskType) {
    items.push({
      id: "taskType",
      label: SUPPORT_QUESTION[draft.requestType],
      hint: taskTypeNames(draft.requestType).join(", "),
    });
    return { items: presentQuestions(draft, items, []), warnings };
  }

  const followUps = followUpsFor(draft.requestType, draft.taskType);
  for (const field of followUps) {
    if (!field.required) continue;
    if (skipExactCopy(draft, field)) continue;
    if (followUpAnswerCounts(field, draft.followUps?.[field.label], Boolean(draft.pricePending))) continue;
    items.push(missingFollowUp(field, Boolean(draft.pricePending)));
  }

  const lead = leadTimeFor(draft);
  if (!draft.requestedCompletionDate) {
    items.push({
      id: "requestedCompletionDate",
      label: "When this needs to be live",
      hint: `${lead.phrase}. A real date, not ASAP.`,
    });
  } else {
    const days = daysUntil(draft.requestedCompletionDate, today);
    if (days < 0) {
      warnings.push(
        `The due date ${draft.requestedCompletionDate} is already past. Say if you still want this filed.`,
      );
    } else if (leadTimeIsTight(draft, today)) {
      const sentence = leadTimeSentence(draft, today);
      if (sentence) warnings.push(sentence);
    }
  }

  if (leadTimeIsTight(draft, today) && !isFilled(draft.consequenceOfDelay)) {
    items.push({
      id: "consequenceOfDelay",
      label: "What happens if it's late",
      hint: "One line on what is lost if this misses the lead time.",
    });
  }

  for (const extra of webAndOfferQuestions(draft)) items.push(extra);

  if (!copySatisfied(draft, followUps)) {
    items.push({
      id: "copy",
      label: "Final copy, or who is writing it and when it's due",
      hint: "Paste the final copy, or name the owner and the date. TBD alone is not enough.",
    });
  }

  if (requestHasFiles(draft)) {
    items.push(...attachmentMissing(draft));
  } else if (!assetsSatisfied(draft, followUps)) {
    items.push({
      id: "assets",
      label: "Assets",
      hint: "A Brandfolder, Dropbox, Drive, or Slack link to the original file. A photo of a menu or a screenshot inside a deck doesn't count. If the file isn't ready, name who will deliver it and the date.",
    });
  }

  if (!isFilled(draft.approver)) {
    items.push({
      id: "approver",
      label: "Final approver",
      hint: "Say me if you'll approve it, or give the name of someone else.",
    });
  }

  if (!destinationSatisfied(draft, followUps)) {
    items.push({
      id: "whereItGoesLive",
      label: "Where it goes live",
      hint: "A URL, channel, or handle.",
    });
  }

  const visible = presentQuestions(draft, items, followUps);
  return { items: draft.requestType === "Web" ? orderWebQuestions(visible) : visible, warnings };
}

function applyConfiguredApprover(draft: BriefDraft): void {
  if (draft.approverSource === "named" || draft.approverSource === "requester") return;
  if (draft.approver && draft.approverSource !== "configured") return;
  const reviewer = configuredReviewer(draft.taskType);
  if (!reviewer) return;
  draft.approver = reviewer.name;
  draft.approverSlackId = reviewer.slackId;
  draft.approverSource = "configured";
}

const WEB_BRIEF_TYPES = new Set(["New Page", "Page Edit", "Happenings", "Menu Upload"]);

const OFFER_FIELDS = [
  "When the old offer comes down",
  "What replaces it in ads or evergreen campaigns",
  "Rate or promo codes in transactional emails",
  "Offer copy, rules, and photo",
] as const;

export function offerInvolved(draft: BriefDraft): boolean {
  if (draft.taskType === "Offers") return true;
  const blob = [draft.requestName, draft.notes, draft.taskType].filter(Boolean).join("\n");
  return /\boffer swap\b|\bold offer\b|\breplace(?:s|d)? (?:the |an )?offer\b|\bpromo code\b|\brate code\b/i.test(blob);
}

function webAndOfferQuestions(draft: BriefDraft): MissingItem[] {
  const items: MissingItem[] = [];
  if (draft.requestType === "Web" && draft.taskType && WEB_BRIEF_TYPES.has(draft.taskType)) {
    if (draft.copyReady === undefined && !webCopySatisfied(draft)) {
      items.push({
        id: "copyReady",
        label: "Is the copy ready?",
        hint: "If yes, paste it. If not, say who is writing it and by when.",
      });
    } else if (draft.copyReady === false && (!isFilled(draft.copyOwner) || !isFilled(draft.copyDueDate))) {
      items.push({
        id: "copyPlan",
        label: "Who is writing the copy, and by when",
        hint: "Name the person and the date.",
      });
    }
    if (draft.designNeeded === undefined && !copyOnlyChange(draft)) {
      items.push({
        id: "designNeeded",
        label: "Is design needed?",
        hint: "Yes if a designer should make it. No if the web team can use the existing layout.",
      });
    }
    if ((draft.taskType === "New Page" || draft.taskType === "Page Edit") && !isFilled(draft.followUps?.["What it replaces and where it sits"])) {
      items.push({
        id: "followup:What it replaces and where it sits",
        label: "What it replaces and where it sits",
        hint: "What comes down, and where this sits on the page. Say none if it is brand new.",
      });
    }
  }
  if (offerInvolved(draft)) {
    for (const label of OFFER_FIELDS) {
      if (isFilled(draft.followUps?.[label])) continue;
      items.push({ id: `followup:${label}`, label, hint: "A short answer is enough. No is a real answer." });
    }
  }
  return items;
}

function skipExactCopy(draft: BriefDraft, field: FollowUp): boolean {
  if (draft.requestType !== "Web" || !draft.taskType || !WEB_BRIEF_TYPES.has(draft.taskType)) return false;
  if (!field.satisfies?.includes("copy")) return false;
  return draft.copyReady !== true;
}

function webCopySatisfied(draft: BriefDraft): boolean {
  if (draft.copyReady === true) return false;
  return isFilled(draft.finalCopy) || isFilled(draft.followUps?.["Page Copy (Exact)"])
    || isFilled(draft.followUps?.["Page Change Details (exact copy provided, if required)"])
    || isFilled(draft.followUps?.["Event Description (Exact)"])
    || isFilled(draft.followUps?.["Details"]);
}

function copyOnlyChange(draft: BriefDraft): boolean {
  if (draft.taskType !== "Page Edit") return false;
  const blob = `${draft.requestName ?? ""} ${draft.notes ?? ""} ${draft.followUps?.["Page Change Details (exact copy provided, if required)"] ?? ""}`;
  return /\b(just|only) (the )?(copy|text|wording)\b|\bcopy only\b|\bchange the (copy|text|wording)\b/i.test(blob)
    && !/\b(design|layout|banner|figma)\b/i.test(blob);
}

function orderWebQuestions(items: MissingItem[]): MissingItem[] {
  const rank = (item: MissingItem): number => {
    if (item.id === "requesterName") return 0;
    if (item.id === "requesterEmail") return 1;
    if (item.id === "taskType" || item.id === "requestType") return 2;
    if (item.id === "properties") return 3;
    if (item.id === "requestName") return 4;
    if (item.id === "copyReady" || item.id === "copyPlan" || item.id === "copy") return 5;
    if (item.id === "designNeeded") return 6;
    if (item.id === "requestedCompletionDate" || item.id === "timing") return 7;
    if (item.id === "consequenceOfDelay") return 8;
    if (item.id.endsWith(":URL")) return 9;
    if (/page change|headline|page copy|event /i.test(item.label)) return 10;
    if (item.label === "What it replaces and where it sits") return 11;
    if (OFFER_FIELDS.includes(item.label as typeof OFFER_FIELDS[number])) return 12;
    if (item.id === "menuPdf" || item.id === "assets" || item.id.startsWith("attachment")) return 13;
    if (item.id === "approver") return 14;
    return 10;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

function presentQuestions(draft: BriefDraft, items: MissingItem[], followUps: FollowUp[]): MissingItem[] {
  const skipped = new Set((draft.skipped ?? []).map((entry) => entry.id));
  if (skipped.has("timing")) {
    skipped.add("requestedCompletionDate");
    skipped.add("consequenceOfDelay");
  }
  if (skipped.has("eventWhen")) {
    skipped.add("followup:Event Date(s)");
    skipped.add("followup:Event Time (Start – End)");
  }
  const visible = items
    .map((item) => specificQuestion(item, followUps, draft))
    .filter((item) => !skipped.has(item.id));
  return combineQuestions(visible);
}

function specificQuestion(item: MissingItem, followUps: FollowUp[], draft: BriefDraft): MissingItem {
  if (item.id === "assets") {
    const field = followUps.find((entry) => entry.satisfies?.includes("assets") && !isFilled(draft.followUps?.[entry.label]));
    if (field) return missingFollowUp(field, Boolean(draft.pricePending));
  }
  if (item.id === "whereItGoesLive") {
    const field = followUps.find((entry) => entry.satisfies?.includes("destination") && !isFilled(draft.followUps?.[entry.label]));
    if (field) return missingFollowUp(field, Boolean(draft.pricePending));
  }
  return item;
}

export function combineQuestions(items: MissingItem[]): MissingItem[] {
  let next = [...items];
  const dateAt = next.findIndex((item) => item.id === "requestedCompletionDate");
  const whyAt = next.findIndex((item) => item.id === "consequenceOfDelay");
  if (dateAt >= 0 && whyAt >= 0) {
    const at = Math.min(dateAt, whyAt);
    next = next.filter((item) => item.id !== "requestedCompletionDate" && item.id !== "consequenceOfDelay");
    next.splice(at, 0, {
      id: "timing",
      label: "When do you need this, and what happens if it's late?",
      hint: "A real date, not ASAP, and one line on what is lost if it's late.",
    });
  }
  const eventDate = "followup:Event Date(s)";
  const eventTime = "followup:Event Time (Start – End)";
  if (next.some((item) => item.id === eventDate) && next.some((item) => item.id === eventTime)) {
    const at = next.findIndex((item) => item.id === eventDate || item.id === eventTime);
    next = next.filter((item) => item.id !== eventDate && item.id !== eventTime);
    next.splice(at, 0, {
      id: "eventWhen",
      label: "When is the event?",
      hint: "The date, plus the start and end time.",
    });
  }
  return next;
}

function missingFollowUp(field: FollowUp, pricePending: boolean): MissingItem {
  const hints: string[] = [];
  if (PRICE_WORD.test(field.label) && !isPriceOnlyField(field.label)) {
    hints.push("Price can stay pending. Send the rest of this answer in your own words.");
  } else if (pricePending && isPriceOnlyField(field.label)) {
    hints.push(PRICE_PENDING_LINE);
  }
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
  if (draft.rushBlock && draft.rushApprovedFor !== draft.requestedCompletionDate) return false;
  // Attachment kind and PDF questions are asked before Confirm is offered.
  // A file found on the thread parent at the moment of Confirm is still uploaded.
  const items = listMissing(draft, today).items.filter((item) => !item.id.startsWith("attachment"));
  return items.length === 0 && Boolean(draft.requestType && draft.taskType);
}

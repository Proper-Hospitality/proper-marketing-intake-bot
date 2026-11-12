import { daysUntil } from "./catalog.js";
import { addCalendarDays, laIsoDate, weekdayIndex } from "./rush.js";
import type { BriefDraft } from "./types.js";

/** Working-day lead times Elena approved. Other task types keep the 7-day check. */
const NAMED_WORKING_DAYS: Record<string, number> = {
  "New Page": 10,
  Offers: 5,
  "Page Edit": 3,
  Happenings: 1,
  "Menu Upload": 1,
};

const NAMED_PHRASE: Record<string, string> = {
  "New Page": "New pages need about 10 working days",
  Offers: "Offers need about 5 working days",
  "Page Edit": "Page edits need about 3 working days",
  Happenings: "Happenings need about 1 working day",
  "Menu Upload": "Menu uploads need about 1 working day",
};

export interface LeadTime {
  days: number;
  kind: "working" | "calendar";
  phrase: string;
  named: boolean;
}

export function leadTimeFor(draft: BriefDraft): LeadTime {
  const task = draft.taskType ?? "";
  const named = NAMED_WORKING_DAYS[task];
  if (named) {
    return {
      days: named,
      kind: "working",
      phrase: NAMED_PHRASE[task] ?? `${task} needs about ${named} working days`,
      named: true,
    };
  }
  return {
    days: 7,
    kind: "calendar",
    phrase: "This request uses a 7-day lead time",
    named: false,
  };
}

/** Weekdays strictly after today, up to and including the due date. */
export function workingDaysUntil(dueIso: string, today: Date): number {
  const start = laIsoDate(today);
  if (dueIso <= start) return 0;
  let count = 0;
  let cursor = start;
  while (cursor < dueIso) {
    cursor = addCalendarDays(cursor, 1);
    const day = weekdayIndex(cursor);
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function daysOut(draft: BriefDraft, today: Date): number | undefined {
  if (!draft.requestedCompletionDate) return undefined;
  const rule = leadTimeFor(draft);
  return rule.kind === "working"
    ? workingDaysUntil(draft.requestedCompletionDate, today)
    : daysUntil(draft.requestedCompletionDate, today);
}

export function leadTimeIsTight(draft: BriefDraft, today: Date): boolean {
  const left = daysOut(draft, today);
  if (left === undefined || left < 0) return false;
  return left < leadTimeFor(draft).days;
}

export function leadTimeSentence(draft: BriefDraft, today: Date): string | undefined {
  if (!draft.requestedCompletionDate) return undefined;
  const left = daysOut(draft, today);
  if (left === undefined || left < 0) return undefined;
  const rule = leadTimeFor(draft);
  const unit = rule.kind === "working" ? "working day" : "day";
  const count = `${left} ${unit}${left === 1 ? "" : "s"}`;
  if (left < rule.days) {
    if (!rule.named) {
      return `${draft.requestedCompletionDate} is inside the 7-day lead time (${left} day${left === 1 ? "" : "s"} out). What happens if it's late is what gets it prioritized.`;
    }
    return `${rule.phrase}. ${draft.requestedCompletionDate} is ${count} out, which is tighter than that. What happens if it's late?`;
  }
  return `${rule.phrase}. ${draft.requestedCompletionDate} is ${count} out, so that fits.`;
}

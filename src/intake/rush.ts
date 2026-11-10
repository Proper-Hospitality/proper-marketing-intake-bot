const LA = "America/Los_Angeles";

export type RushReason = "same_day" | "next_day" | "weekend";

export interface RushApprover {
  id: string;
  name: string;
}

/** Koral Captain and DeeDee Brown, unless the environment overrides the Slack user ids. */
export function rushApprovers(env: NodeJS.ProcessEnv = process.env): RushApprover[] {
  return [
    { id: env.RUSH_APPROVER_KORAL_ID || "U0B5F1HN98Q", name: "Koral Captain" },
    { id: env.RUSH_APPROVER_DEEDEE_ID || "U0B6N3RE23T", name: "DeeDee Brown" },
  ];
}

export function laIsoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addCalendarDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function weekdayIndex(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Block same-day and next-day dates, any Saturday or Sunday due date, and a
 * Friday request that is due the following Saturday, Sunday, or Monday.
 * A Saturday request due the following Monday is allowed: Monday is not a
 * weekend day, and it is not the next day.
 */
export function classifyRush(dueIso: string, now: Date): RushReason | null {
  const today = laIsoDate(now);
  if (dueIso < today) return null;
  if (dueIso === today) return "same_day";
  if (dueIso === addCalendarDays(today, 1)) return "next_day";
  const dueDay = weekdayIndex(dueIso);
  if (dueDay === 0 || dueDay === 6) return "weekend";
  if (weekdayIndex(today) === 5 && dueIso === addCalendarDays(today, 3)) return "weekend";
  return null;
}

export function rushExplanation(reason: RushReason, dueIso: string): string {
  const why = reason === "weekend"
    ? `${dueIso} is a weekend date, or the Monday after a Friday request.`
    : reason === "same_day"
      ? `${dueIso} is the same day.`
      : `${dueIso} is the next day.`;
  return `${why} That needs approval before a task can be filed. Reply *Request approval* and I'll ask Koral Captain and DeeDee Brown. Or send a later date.`;
}

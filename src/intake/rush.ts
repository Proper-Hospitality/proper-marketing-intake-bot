const LA = "America/Los_Angeles";

export type RushReason = "same_day" | "next_day" | "friday_monday" | "weekend";

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

/** Saturday and Sunday due dates cannot be approved. Next-day and Friday → Monday can. */
export function rushAllowsApproval(reason: RushReason): boolean {
  return reason !== "weekend";
}

/**
 * Block same-day and next-day dates, any Saturday or Sunday due date, and a
 * Friday request due the following Monday.
 * A Saturday or Sunday due date has no approval path, including Friday → Saturday.
 * A Saturday request due the following Monday is allowed.
 */
export function classifyRush(dueIso: string, now: Date): RushReason | null {
  const today = laIsoDate(now);
  if (dueIso < today) return null;
  const dueDay = weekdayIndex(dueIso);
  if (dueDay === 0 || dueDay === 6) return "weekend";
  if (weekdayIndex(today) === 5 && dueIso === addCalendarDays(today, 3)) return "friday_monday";
  if (dueIso === today) return "same_day";
  if (dueIso === addCalendarDays(today, 1)) return "next_day";
  return null;
}

export function rushExplanation(reason: RushReason, dueIso: string): string {
  if (reason === "weekend") {
    return `${dueIso} is a Saturday or Sunday, so it can't be the due date. Send a weekday.`;
  }
  const why = reason === "friday_monday"
    ? `${dueIso} is the Monday after a Friday request.`
    : reason === "same_day"
      ? `${dueIso} is the same day.`
      : `${dueIso} is the next day.`;
  return `${why} That needs approval before a task can be filed. Press *Request approval*, or reply with that, and I'll ask DeeDee Brown and Koral Captain. Or send a later date.`;
}

/** Slack mrkdwn and a trailing punctuation mark, so "*Request approval*" still matches. */
export function plainSlackText(text: string): string {
  return text
    .replace(/[*_~`]/g, "")
    .replace(/<@[A-Z0-9]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The requester wants the rush sent to DeeDee and Koral.
 * Matches "Request Approval", "*Request approval*", "please request approval",
 * "yes ask them", "ask them", and "you said you would ask them?".
 */
export function wantsRushApproval(text: string): boolean {
  const plain = plainSlackText(text).replace(/[.!?]+$/g, "").trim();
  if (!plain || plain.length > 160) return false;
  if (/\brequest(?:ing)?\s+approval\b/i.test(plain)) return true;
  if (/\byou said you would ask\b/i.test(plain)) return true;
  if (/\b(?:please\s+)?(?:yes\s+)?ask\s+(?:them|koral|deedee|dee dee)\b/i.test(plain)) return true;
  if (/\b(?:go ahead and ask|ask for approval)\b/i.test(plain)) return true;
  return false;
}

export function rushAskedText(mentionsOn: boolean): string {
  const names = "DeeDee Brown and Koral Captain";
  if (mentionsOn) {
    return `I've asked ${names} to approve. I'll file it as soon as one approves.`;
  }
  return `I've asked ${names} to approve. Each of them gets a direct message from me with Approve and Decline, since mentions are off. I'll file it as soon as one approves.`;
}

export function rushAlreadyAskedText(): string {
  return "I've already asked DeeDee Brown and Koral Captain to approve. I'll file it as soon as one approves.";
}

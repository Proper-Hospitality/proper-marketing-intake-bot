import { addCalendarDays, laIsoDate, weekdayIndex } from "./rush.js";

/** Kickoff length and the window Elena asked for: weekdays, 9 AM to 5 PM Pacific. */
export const KICKOFF_MINUTES = 15;
export const BUSINESS_START_HOUR = 9;
export const BUSINESS_END_HOUR = 17;
export const ORGANIZER_TIME_ZONE = "America/Los_Angeles";
export const GRAPH_TIME_ZONE = "Pacific Standard Time";
export const DEFAULT_ORGANIZER_EMAIL = "elena.ruiz@properhotel.com";

export interface KickoffSlot {
  id: string;
  start: string;
  end: string;
  label: string;
}

export interface ScheduleProposal {
  source: "graph" | "fallback";
  organizer: string;
  durationMinutes: number;
  slots: KickoffSlot[];
  note?: string;
}

export interface MeetingSuggestion {
  start: string;
  end: string;
  timeZone?: string;
}

export interface ScheduleBusy {
  start: string;
  end: string;
  timeZone?: string;
}

export interface CalendarClient {
  findMeetingTimes(input: {
    organizer: string;
    attendees: string[];
    windowStart: string;
    windowEnd: string;
    durationMinutes: number;
  }): Promise<MeetingSuggestion[]>;
  getSchedule(input: {
    organizer: string;
    schedules: string[];
    windowStart: string;
    windowEnd: string;
  }): Promise<ScheduleBusy[]>;
}

const FALLBACK_NOTE =
  "Free/busy isn't available, so these are three open weekday times on the organizer's calendar, 9 AM to 5 PM PT. They are not confirmed free.";

export function organizerEmail(env: NodeJS.ProcessEnv = process.env): string {
  return env.CALENDAR_ORGANIZER_EMAIL?.trim() || DEFAULT_ORGANIZER_EMAIL;
}

export function calendarConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.MS_GRAPH_TENANT_ID?.trim()
    && env.MS_GRAPH_CLIENT_ID?.trim()
    && env.MS_GRAPH_CLIENT_SECRET?.trim(),
  );
}

/**
 * Three 15-minute starts at 10:00, 11:00, and 2:00 PM PT on the next weekdays
 * that are still ahead. Used when Graph free/busy is missing or unauthorized.
 */
export function fallbackKickoffSlots(now: Date, count = 3): KickoffSlot[] {
  const hours = [10, 11, 14];
  const today = laIsoDate(now);
  const slots: KickoffSlot[] = [];
  for (let day = 0; day < 21 && slots.length < count; day += 1) {
    const iso = addCalendarDays(today, day);
    const weekday = weekdayIndex(iso);
    if (weekday === 0 || weekday === 6) continue;
    for (const hour of hours) {
      if (slots.length >= count) break;
      const start = zonedTime(iso, hour, 0);
      const end = new Date(start.getTime() + KICKOFF_MINUTES * 60 * 1000);
      if (start.getTime() <= now.getTime() + 15 * 60 * 1000) continue;
      if (!isWeekdayBusinessSlot(start, end)) continue;
      slots.push(toSlot(slots.length, start, end));
    }
  }
  return slots;
}

export function fallbackProposal(now: Date, organizer = organizerEmail()): ScheduleProposal {
  return {
    source: "fallback",
    organizer,
    durationMinutes: KICKOFF_MINUTES,
    slots: fallbackKickoffSlots(now),
    note: FALLBACK_NOTE,
  };
}

/**
 * Prefer Graph findMeetingTimes, then free slots from getSchedule.
 * Any failure, empty result, or missing client becomes the fallback slots.
 */
export async function proposeKickoff(input: {
  now: Date;
  organizer?: string;
  attendees?: string[];
  client?: CalendarClient | null;
}): Promise<ScheduleProposal> {
  const organizer = input.organizer ?? organizerEmail();
  const fallback = fallbackProposal(input.now, organizer);
  if (!input.client) return fallback;
  const window = businessWindow(input.now, 5);
  try {
    const suggestions = await input.client.findMeetingTimes({
      organizer,
      attendees: (input.attendees ?? []).filter((email) => email && email !== organizer),
      windowStart: window.start,
      windowEnd: window.end,
      durationMinutes: KICKOFF_MINUTES,
    });
    const fromGraph = usableSlots(suggestions, input.now);
    if (fromGraph.length > 0) {
      return { source: "graph", organizer, durationMinutes: KICKOFF_MINUTES, slots: fromGraph.slice(0, 3) };
    }
  } catch (error) {
    console.warn(JSON.stringify({
      msg: "calendar_find_meeting_times_failed",
      error: error instanceof Error ? error.message : "unknown",
    }));
  }
  try {
    const busy = await input.client.getSchedule({
      organizer,
      schedules: [organizer, ...(input.attendees ?? [])].filter((email, index, all) => email && all.indexOf(email) === index),
      windowStart: window.start,
      windowEnd: window.end,
    });
    const free = freeSlots(input.now, busy);
    if (free.length > 0) {
      return { source: "graph", organizer, durationMinutes: KICKOFF_MINUTES, slots: free.slice(0, 3) };
    }
  } catch (error) {
    console.warn(JSON.stringify({
      msg: "calendar_get_schedule_failed",
      error: error instanceof Error ? error.message : "unknown",
    }));
  }
  return fallback;
}

export function formatScheduleMessage(proposal: ScheduleProposal): string {
  const lines = [
    `I can hold 15 minutes with ${proposal.organizer} as the organizer. Weekdays, 9 AM to 5 PM PT.`,
    proposal.note ?? "These times are free on the calendar.",
    ...proposal.slots.map((slot, index) => `${index + 1}. ${slot.label}`),
    "Pick one with a button, or react with :one:, :two:, or :three:.",
  ];
  return lines.join("\n");
}

export function parseSlotChoice(text: string, slots: KickoffSlot[]): KickoffSlot | undefined {
  const plain = text.trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (!plain) return undefined;
  const numbered = plain.match(/^(?:option\s*)?([123])\b/);
  if (numbered) return slots[Number(numbered[1]) - 1];
  if (/^(the )?first\b/.test(plain)) return slots[0];
  if (/^(the )?second\b/.test(plain)) return slots[1];
  if (/^(the )?third\b/.test(plain)) return slots[2];
  const hit = slots.find((slot) => plain.includes(slot.label.toLowerCase()));
  return hit;
}

export function reactionSlotIndex(reaction: string): number | undefined {
  const name = reaction.replace(/:/g, "").toLowerCase();
  if (name === "one" || name === "1") return 0;
  if (name === "two" || name === "2") return 1;
  if (name === "three" || name === "3") return 2;
  return undefined;
}

function usableSlots(suggestions: MeetingSuggestion[], now: Date): KickoffSlot[] {
  const slots: KickoffSlot[] = [];
  for (const suggestion of suggestions) {
    const start = graphInstant(suggestion.start, suggestion.timeZone);
    const end = graphInstant(suggestion.end, suggestion.timeZone);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    if (start.getTime() <= now.getTime()) continue;
    if (!isWeekdayBusinessSlot(start, end)) continue;
    slots.push(toSlot(slots.length, start, end));
    if (slots.length === 3) break;
  }
  return slots;
}

function freeSlots(now: Date, busy: ScheduleBusy[]): KickoffSlot[] {
  const blocks = busy
    .map((item) => ({
      start: graphInstant(item.start, item.timeZone).getTime(),
      end: graphInstant(item.end, item.timeZone).getTime(),
    }))
    .filter((item) => !Number.isNaN(item.start) && !Number.isNaN(item.end));
  const candidates = fallbackKickoffSlots(now, 12);
  return candidates.filter((slot) => {
    const start = new Date(slot.start).getTime();
    const end = new Date(slot.end).getTime();
    return !blocks.some((block) => start < block.end && end > block.start);
  }).slice(0, 3).map((slot, index) => ({ ...slot, id: String(index) }));
}

export function businessWindow(now: Date, days: number): { start: string; end: string } {
  const startIso = laIsoDate(now);
  let endIso = startIso;
  let counted = 0;
  for (let day = 0; day < 21 && counted < days; day += 1) {
    const iso = addCalendarDays(startIso, day);
    const weekday = weekdayIndex(iso);
    if (weekday === 0 || weekday === 6) continue;
    endIso = iso;
    counted += 1;
  }
  return {
    start: `${startIso}T09:00:00`,
    end: `${endIso}T17:00:00`,
  };
}

export function isWeekdayBusinessSlot(start: Date, end: Date): boolean {
  const startParts = laParts(start);
  const endParts = laParts(end);
  if (startParts.weekday === 0 || startParts.weekday === 6) return false;
  if (startParts.isoDate !== endParts.isoDate) return false;
  const startMinutes = startParts.hour * 60 + startParts.minute;
  const endMinutes = endParts.hour * 60 + endParts.minute;
  return startMinutes >= BUSINESS_START_HOUR * 60 && endMinutes <= BUSINESS_END_HOUR * 60 && endMinutes > startMinutes;
}

function toSlot(index: number, start: Date, end: Date): KickoffSlot {
  return {
    id: String(index),
    start: start.toISOString(),
    end: end.toISOString(),
    label: formatSlotLabel(start, end),
  };
}

export function formatSlotLabel(start: Date, end: Date): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: ORGANIZER_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: ORGANIZER_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day}, ${clock.format(start)}–${clock.format(end)} PT`;
}

function laParts(date: Date): { isoDate: string; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ORGANIZER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdayName = parts.weekday ?? "Sun";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

/** A clock time in America/Los_Angeles, as a UTC Date. */
export function zonedTime(isoDate: string, hour: number, minute: number): Date {
  const guess = new Date(`${isoDate}T${pad(hour)}:${pad(minute)}:00Z`);
  const offset = zoneOffset(guess, ORGANIZER_TIME_ZONE);
  const adjusted = new Date(guess.getTime() - offset);
  const drift = zoneOffset(adjusted, ORGANIZER_TIME_ZONE) - offset;
  return drift === 0 ? adjusted : new Date(adjusted.getTime() - drift);
}

function zoneOffset(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Graph dateTime is in its timeZone. A value with Z or an offset is already absolute. */
export function graphInstant(dateTime: string, timeZone?: string): Date {
  const trimmed = dateTime.trim();
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) return new Date(trimmed);
  if (!timeZone || /utc/i.test(timeZone)) return new Date(trimmed.replace(/\.\d+$/, "") + "Z");
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return new Date(trimmed);
  return zonedTime(match[1], Number(match[2]), Number(match[3]));
}

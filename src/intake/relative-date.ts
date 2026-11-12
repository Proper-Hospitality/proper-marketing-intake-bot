import { normalizeDate } from "./catalog.js";
import type { BriefDraft } from "./types.js";
import { addCalendarDays, classifyRush, laIsoDate, weekdayIndex } from "./rush.js";

const DAY =
  "sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wednesday|weds|wed|thu|thur|thurs|fri|sat";
const MONTH =
  "january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec";

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface ResolvedDate {
  iso: string;
  /** True for this Friday, tomorrow, next Tuesday, EOW, and similar. */
  relative: boolean;
  phrase: string;
}

interface Candidate {
  iso: string;
  relative: boolean;
  phrase: string;
  index: number;
  score: number;
}

/**
 * Resolve a due date against today in America/Los_Angeles.
 * "this Friday" and a bare "Friday" mean the upcoming one, including today.
 * "next Tuesday" means that weekday in the following week (weeks start Sunday).
 * EOW is the Friday of the current week, or the next Friday if that day has passed.
 */
/** A message that actually names a due date, not a question about the approval. */
export function messageSuppliesDate(text: string): boolean {
  const plain = text.replace(/[*_~`]/g, " ");
  return /\b(?:today|tomorrow|eow|end of(?: the)? week|due\b|deadline|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+\d{1,2})?\b|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(plain);
}

export function extractDueDate(
  text: string,
  now: Date,
  options: { expectingDate?: boolean } = {},
): ResolvedDate | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const today = laIsoDate(now);
  const candidates: Candidate[] = [];
  collectCalendarDates(trimmed, today, candidates);
  collectRelativeDates(trimmed, today, options.expectingDate === true, candidates);
  const pool = candidates.filter((item) => {
    if (!item.relative) return true;
    return !candidates.some((other) => (
      !other.relative && spansOverlap(item.index, item.phrase.length, other.index, other.phrase.length)
    ));
  });
  pool.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = pool[0];
  if (!best) return undefined;
  return { iso: best.iso, relative: best.relative, phrase: best.phrase };
}

/** A single field value: ISO, US numeric, "Nov 13", "this Friday", "tomorrow", "EOW". */
export function resolveDateInput(input: string, now: Date): ResolvedDate | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const iso = normalizeDate(trimmed);
  if (iso) return { iso, relative: false, phrase: trimmed };
  return extractDueDate(trimmed, now, { expectingDate: true });
}

export function formatSpokenDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${SHORT_DAY[date.getUTCDay()]} ${SHORT_MONTH[month - 1]} ${day}`;
}

export function assignCompletionDate(draft: BriefDraft, iso: string, today: Date): void {
  draft.requestedCompletionDate = iso;
  const rush = classifyRush(iso, today);
  if (rush && draft.rushApprovedFor !== iso) draft.rushBlock = rush;
  else delete draft.rushBlock;
}

function collectCalendarDates(text: string, today: string, into: Candidate[]): void {
  const isoRe = /\b(\d{4}-\d{2}-\d{2})\b/g;
  for (const match of text.matchAll(isoRe)) {
    const iso = normalizeDate(match[1]);
    if (!iso || match.index == null) continue;
    into.push(scored(iso, false, match[1], match.index, text, 100));
  }
  const usRe = /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g;
  for (const match of text.matchAll(usRe)) {
    const iso = normalizeDate(match[1]);
    if (!iso || match.index == null) continue;
    into.push(scored(iso, false, match[1], match.index, text, 100));
  }
  const monthRe = new RegExp(
    `\\b(?:(${DAY})[,\\s]+)?(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`,
    "gi",
  );
  for (const match of text.matchAll(monthRe)) {
    if (match.index == null) continue;
    const weekday = match[1] ? weekdayFromName(match[1]) : undefined;
    const month = monthFromName(match[2]);
    const day = Number(match[3]);
    const year = match[4] ? Number(match[4]) : undefined;
    const iso = resolveMonthDay(month, day, year, weekday, today);
    if (!iso) continue;
    into.push(scored(iso, false, match[0], match.index, text, 100));
  }
}

function collectRelativeDates(text: string, today: string, expectingDate: boolean, into: Candidate[]): void {
  const eow = /\b(?:eow|end of(?: the)? week)\b/gi;
  for (const match of text.matchAll(eow)) {
    if (match.index == null) continue;
    into.push(scored(upcomingWeekday(today, 5, "bare"), true, match[0], match.index, text, 60));
  }
  const ahead = /\b(?:in\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\s+from\s+now\b|\bin\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?\b/gi;
  for (const match of text.matchAll(ahead)) {
    if (match.index == null) continue;
    const raw = (match[1] || match[2] || "").toLowerCase();
    const days = Number.isFinite(Number(raw)) ? Number(raw) : NUMBER_WORDS[raw];
    if (!days && days !== 0) continue;
    into.push(scored(addCalendarDays(today, days), true, match[0], match.index, text, 55));
  }
  const pointed = new RegExp(`\\b(this|next)\\s+(?:coming\\s+)?(${DAY})\\b`, "gi");
  for (const match of text.matchAll(pointed)) {
    if (match.index == null) continue;
    const modifier = match[1].toLowerCase() === "next" ? "next" : "this";
    into.push(scored(upcomingWeekday(today, weekdayFromName(match[2]), modifier), true, match[0], match.index, text, 70));
  }
  const cued = new RegExp(`\\b(due|by|before|on|needed)\\s+(?:(this|next)\\s+)?(?:coming\\s+)?(${DAY})\\b`, "gi");
  for (const match of text.matchAll(cued)) {
    if (match.index == null) continue;
    const modifier = match[2]?.toLowerCase() === "next" ? "next" : match[2]?.toLowerCase() === "this" ? "this" : "bare";
    into.push(scored(upcomingWeekday(today, weekdayFromName(match[3]), modifier), true, match[0], match.index, text, 65));
  }
  const todayTomorrow = /\b(today|tomorrow)(?!'s)\b/gi;
  for (const match of text.matchAll(todayTomorrow)) {
    if (match.index == null) continue;
    const word = match[1].toLowerCase();
    const cuedWord = hasCue(text, match.index);
    if (word === "today" && !expectingDate && !cuedWord) continue;
    const iso = word === "today" ? today : addCalendarDays(today, 1);
    into.push(scored(iso, true, match[0], match.index, text, word === "tomorrow" ? 60 : 45));
  }
  if (expectingDate) {
    const bare = new RegExp(`\\b(${DAY})\\b`, "gi");
    for (const match of text.matchAll(bare)) {
      if (match.index == null) continue;
      into.push(scored(upcomingWeekday(today, weekdayFromName(match[1]), "bare"), true, match[0], match.index, text, 25));
    }
  }
}

function scored(iso: string, relative: boolean, phrase: string, index: number, text: string, score: number): Candidate {
  return { iso, relative, phrase, index, score: score + (hasCue(text, index) ? 5 : 0) };
}

function hasCue(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 32), index);
  return /\b(due|by|before|needed|deadline|no later than|submitted)\b/i.test(before);
}

function upcomingWeekday(today: string, target: number, modifier: "this" | "next" | "bare"): string {
  const todayDow = weekdayIndex(today);
  if (modifier === "next") {
    const daysUntilNextSunday = (7 - todayDow) % 7 || 7;
    return addCalendarDays(today, daysUntilNextSunday + target);
  }
  const delta = (target - todayDow + 7) % 7;
  return addCalendarDays(today, delta);
}

function resolveMonthDay(
  month: number,
  day: number,
  year: number | undefined,
  weekday: number | undefined,
  today: string,
): string | undefined {
  const todayYear = Number(today.slice(0, 4));
  const years = year ? [year] : [todayYear, todayYear + 1];
  const candidates = years
    .map((value) => isoFromParts(value, month, day))
    .filter((iso): iso is string => Boolean(iso));
  if (candidates.length === 0) return undefined;
  if (weekday != null) {
    const matched = candidates.find((iso) => weekdayIndex(iso) === weekday);
    if (matched) return matched >= today || year ? matched : candidates.find((iso) => iso >= today) ?? matched;
  }
  return candidates.find((iso) => iso >= today) ?? candidates[0];
}

function isoFromParts(year: number, month: number, day: number): string | undefined {
  return normalizeDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

function weekdayFromName(name: string): number {
  const value = name.toLowerCase();
  if (value.startsWith("sun")) return 0;
  if (value.startsWith("mon")) return 1;
  if (value.startsWith("tue")) return 2;
  if (value.startsWith("wed")) return 3;
  if (value.startsWith("thu")) return 4;
  if (value.startsWith("fri")) return 5;
  return 6;
}

function monthFromName(name: string): number {
  const value = name.toLowerCase();
  const names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = names.findIndex((item) => value.startsWith(item));
  return index + 1;
}

function spansOverlap(start: number, length: number, otherStart: number, otherLength: number): boolean {
  return start < otherStart + otherLength && otherStart < start + length;
}

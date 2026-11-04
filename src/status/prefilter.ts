const CHAT = /^(thanks|thank you|ty|ok|okay|k|lol|lmao|haha|yes|yeah|yep|no|nope|sounds good|got it|cool|nice|perfect|\+1|👋|👍)[.!\s]*$/i;
const STATUS = /\b(done|finished|complete[d]?|shipped|went live|is live|now live|sent|posted|published|no longer needed|not needed|cancel(?:led|ed)?|due date|new due|push(?:ed|ing)? (?:to|until|back)|reschedul\w*|deadline|moved to|moving to|progress note|status update|blocked|waiting on)\b/i;
const ASANA = /app\.asana\.com\//i;

/** Cheap gate so chit-chat never calls Claude. */
export function mightBeStatusUpdate(text: string): boolean {
  const trimmed = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (trimmed.length < 8 || CHAT.test(trimmed)) return false;
  if (ASANA.test(trimmed)) return true;
  return STATUS.test(trimmed);
}

export function statusChannelIds(raw = process.env.SLACK_STATUS_CHANNELS): Set<string> {
  return new Set((raw ?? "").split(/[,\s]+/).map((id) => id.trim()).filter(Boolean));
}

export const STATUS_RATE_LIMIT = 8;
export const STATUS_RATE_WINDOW_MS = 10 * 60 * 1000;

export function nextRateWindow(input: {
  count: number;
  windowStart: number;
  now: number;
}): { allowed: boolean; count: number; windowStart: number } {
  if (input.now - input.windowStart >= STATUS_RATE_WINDOW_MS) {
    return { allowed: true, count: 1, windowStart: input.now };
  }
  if (input.count >= STATUS_RATE_LIMIT) {
    return { allowed: false, count: input.count, windowStart: input.windowStart };
  }
  return { allowed: true, count: input.count + 1, windowStart: input.windowStart };
}

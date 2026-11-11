import { inferProperties } from "./catalog.js";
import { extractConsequence, extractLinks } from "./capture.js";
import { extractDueDate } from "./relative-date.js";
import type { RecordInput } from "./flow.js";
import type { BriefDraft } from "./types.js";

const VAGUE = /^(it'?s fine|its fine|fine|not sure|idk|i don'?t know|unsure|n\/a|to our page|our page|the page)[.!]?$/i;

export function isVagueAnswer(text: string): boolean {
  return VAGUE.test(text.trim());
}

export function wantsToChat(text: string): boolean {
  return /\b(one at a time|one by one|back and forth|let'?s chat|lets chat|chat through|walk me through)\b/i.test(text);
}

/** A note to teammates, not an answer for the bot. */
export function isTeammateChatter(text: string): boolean {
  const hasMention = /<@[A-Z0-9]+>|@[\w][\w.'-]{1,40}/.test(text);
  if (!hasMention) return false;
  const rest = text
    .replace(/<@[A-Z0-9]+>/g, " ")
    .replace(/@[\w][\w.'-]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\b(https?:\/\/|due\b|approver|skip|ltp|smp|aup|sfp|dtla)\b/i.test(rest)) return false;
  if (extractLinks(text).length > 0) return false;
  return rest.length < 80;
}

export function saysNewPage(text: string): boolean {
  return /\b(it'?s |this is |make it )?a new page\b/i.test(text);
}

export function parseBatchAnswers(text: string, draft: BriefDraft, today: Date): RecordInput {
  const input: RecordInput = {};
  const date = extractDueDate(text, today, { expectingDate: true });
  if (date && !draft.requestedCompletionDate) input.requestedCompletionDate = date.iso;
  const why = extractConsequence(text);
  if (why && !draft.consequenceOfDelay) input.consequenceOfDelay = why;
  const links = extractLinks(text);
  if (links[0]) {
    if (!draft.whereItGoesLive) input.whereItGoesLive = links[0];
    if (draft.requestType === "Web" && (draft.taskType === "Page Edit" || draft.taskType === "New Page" || saysNewPage(text))) {
      input.followUps = { ...(input.followUps ?? {}), URL: links[0] };
    }
  }
  if (saysNewPage(text) && draft.requestType === "Web" && draft.taskType !== "New Page") {
    input.taskType = "New Page";
  }
  const approver = text.match(/\b(?:approver|signed off by|signs off)\s*(?:is|:)?\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)?)/i);
  if (approver?.[1] && !draft.approver) input.approver = approver[1].replace(/[.,]+$/, "");
  if (!draft.properties?.length) {
    const properties = inferProperties(text);
    if (properties.length > 0) input.properties = properties;
  }
  return input;
}

export function batchHasAnswers(input: RecordInput): boolean {
  return Boolean(
    input.requestedCompletionDate
    || input.consequenceOfDelay
    || input.whereItGoesLive
    || input.approver
    || input.taskType
    || (input.properties && input.properties.length > 0)
    || (input.followUps && Object.keys(input.followUps).length > 0),
  );
}

/** A required field that is still on the missing list cannot be skipped. */
export function requiredFieldCannotBeSkipped(id: string | undefined): boolean {
  if (!id || id === "batch") return true;
  return true;
}

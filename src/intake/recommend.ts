import type { ConversationState } from "../store/types.js";

export const LET_MARKETING_RECOMMEND = "Let marketing recommend";

const DATE_QUESTION = /date|timing/i;

export function isUnsureAnswer(text: string): boolean {
  return /^(not sure|unsure|idk|i don'?t know|i do not know|no idea|i have no idea)[.!]?$/i.test(text.trim());
}

export function stillCantGetIt(text: string): boolean {
  return /still (can'?t|cannot|couldn'?t)|can'?t (get|find)|cannot (get|find)|couldn'?t (get|find)|nobody knows/i.test(text.trim());
}

export function wantsMarketingRecommend(text: string): boolean {
  return /^let marketing recommend[.!]?$/i.test(text.trim());
}

export function nudgeToFindAnswer(label: string): string {
  return [
    `Keep *${label}* open. Please go get the actual answer, then reply in this same thread.`,
    "Check the latest file or ask the person who owns that detail (the property sales lead, or whoever set the size, date, or copy).",
  ].join("\n");
}

export function offerMarketingRecommend(label: string): string {
  return `If you still can't get *${label}*, reply *Let marketing recommend*. I'll record that exact line and keep going. If you can get it, send the answer here instead.`;
}

export function dateStillNeeded(label: string): string {
  return `I still need a real date for *${label}*. Check with the person who set the deadline and reply in this thread. I can't file "Let marketing recommend" in place of a date.`;
}

export function isDateQuestion(id: string): boolean {
  return DATE_QUESTION.test(id);
}

export function recordMarketingRecommend(state: ConversationState): boolean {
  const id = state.lastAskedId;
  const label = state.lastAskedLabel;
  if (!id || !label || isDateQuestion(id)) return false;
  const draft = state.draft;
  if (id.startsWith("followup:")) {
    const key = id.slice("followup:".length);
    draft.followUps = { ...(draft.followUps ?? {}), [key]: LET_MARKETING_RECOMMEND };
    return true;
  }
  if (id === "requesterName") draft.requesterName = LET_MARKETING_RECOMMEND;
  else if (id === "requesterEmail") draft.requesterEmail = LET_MARKETING_RECOMMEND;
  else if (id === "requestName") draft.requestName = LET_MARKETING_RECOMMEND;
  else if (id === "consequenceOfDelay") draft.consequenceOfDelay = LET_MARKETING_RECOMMEND;
  else if (id === "approver") draft.approver = LET_MARKETING_RECOMMEND;
  else if (id === "whereItGoesLive") draft.whereItGoesLive = LET_MARKETING_RECOMMEND;
  else if (id === "finalCopy") draft.finalCopy = LET_MARKETING_RECOMMEND;
  else if (id === "copy") {
    draft.finalCopy = LET_MARKETING_RECOMMEND;
  } else if (id === "assets") {
    draft.assets = [LET_MARKETING_RECOMMEND];
  } else {
    return false;
  }
  return true;
}

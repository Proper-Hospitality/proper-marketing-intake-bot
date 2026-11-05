import { listMissing } from "./missing.js";
import type { BriefDraft } from "./types.js";
import type { ConversationState } from "../store/types.js";

const SKIP = /^(skip|not sure|idk|i don'?t know|unsure|n\/a|na)[.!]?$/i;
const BACK = /^(back|go back|previous|edit that|change that|undo)[.!]?$/i;

export function isSkipAnswer(text: string): boolean {
  return SKIP.test(text.trim());
}

export function isBackAnswer(text: string): boolean {
  return BACK.test(text.trim());
}

export function skipAsked(state: ConversationState): boolean {
  const id = state.lastAskedId;
  const label = state.lastAskedLabel;
  if (!id || !label) return false;
  const skipped = (state.draft.skipped ?? []).filter((entry) => entry.id !== id);
  skipped.push({ id, label });
  state.draft.skipped = skipped;
  return true;
}

export function rewindLastAnswer(state: ConversationState): boolean {
  const trail = state.answerTrail ?? [];
  const id = trail.pop();
  if (!id) return false;
  state.answerTrail = trail;
  state.draft.skipped = (state.draft.skipped ?? []).filter((entry) => entry.id !== id);
  clearAsked(state.draft, id);
  state.lastAskedId = undefined;
  state.lastAskedLabel = undefined;
  return true;
}

export function dropSkipsThatWereAnswered(draft: BriefDraft): void {
  if (!draft.skipped || draft.skipped.length === 0) return;
  const stillMissing = new Set(listMissing({ ...draft, skipped: [] }).items.map((item) => item.id));
  if (draft.requestedCompletionDate) stillMissing.delete("requestedCompletionDate");
  if (draft.consequenceOfDelay) stillMissing.delete("consequenceOfDelay");
  if (draft.requestedCompletionDate && draft.consequenceOfDelay) stillMissing.delete("timing");
  const eventDate = draft.followUps?.["Event Date(s)"];
  const eventTime = draft.followUps?.["Event Time (Start – End)"];
  if (eventDate) stillMissing.delete("followup:Event Date(s)");
  if (eventTime) stillMissing.delete("followup:Event Time (Start – End)");
  if (eventDate && eventTime) stillMissing.delete("eventWhen");
  draft.skipped = draft.skipped.filter((entry) => stillMissing.has(entry.id));
  if (draft.skipped.length === 0) delete draft.skipped;
}

function clearAsked(draft: BriefDraft, id: string): void {
  if (id === "timing") {
    delete draft.requestedCompletionDate;
    delete draft.consequenceOfDelay;
    return;
  }
  if (id === "eventWhen") {
    delete draft.followUps?.["Event Date(s)"];
    delete draft.followUps?.["Event Time (Start – End)"];
    return;
  }
  if (id === "requesterName") delete draft.requesterName;
  else if (id === "requesterEmail") delete draft.requesterEmail;
  else if (id === "requestName") delete draft.requestName;
  else if (id === "properties") draft.properties = [];
  else if (id === "requestType") {
    delete draft.requestType;
    delete draft.taskType;
    delete draft.followUps;
  } else if (id === "taskType") {
    delete draft.taskType;
    delete draft.followUps;
  } else if (id === "requestedCompletionDate") delete draft.requestedCompletionDate;
  else if (id === "consequenceOfDelay") delete draft.consequenceOfDelay;
  else if (id === "copy") {
    delete draft.finalCopy;
    delete draft.copyOwner;
    delete draft.copyDueDate;
  } else if (id === "assets") {
    delete draft.assets;
    delete draft.assetsOwner;
    delete draft.assetsDue;
  } else if (id === "approver") delete draft.approver;
  else if (id === "whereItGoesLive") delete draft.whereItGoesLive;
  else if (id.startsWith("followup:")) {
    delete draft.followUps?.[id.slice("followup:".length)];
  }
}

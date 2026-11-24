import { listMissing, type MissingItem } from "./missing.js";
import type { BriefDraft, RequestType } from "./types.js";

export interface TaskRef {
  requestType: RequestType;
  taskType: string;
}

/**
 * The later task depends on the earlier one.
 * The question tree does not store these edges. This list is the pairs the
 * task types and the design-versus-build notes describe.
 */
export interface TaskPair {
  id: string;
  upstream: TaskRef;
  downstream: TaskRef;
  unclearPrompt: string;
}

export const TASK_PAIRS: TaskPair[] = [
  {
    id: "email-send",
    upstream: { requestType: "Creative", taskType: "Email" },
    downstream: { requestType: "CRM & Paid", taskType: "Newsletter Send" },
    unclearPrompt: "Is the email already designed?",
  },
  {
    id: "sms-send",
    upstream: { requestType: "Creative", taskType: "SMS" },
    downstream: { requestType: "CRM & Paid", taskType: "SMS Send" },
    unclearPrompt: "Is the text already written?",
  },
  {
    id: "popup-launch",
    upstream: { requestType: "Creative", taskType: "Pop Up" },
    downstream: { requestType: "CRM & Paid", taskType: "Pop Up" },
    unclearPrompt: "Is the popup already designed?",
  },
  {
    id: "page-build",
    upstream: { requestType: "Creative", taskType: "Web Page" },
    downstream: { requestType: "Web", taskType: "New Page" },
    unclearPrompt: "Is the page already designed?",
  },
  {
    id: "social-post",
    upstream: { requestType: "Creative", taskType: "Social" },
    downstream: { requestType: "Social", taskType: "Feed Post Request" },
    unclearPrompt: "Is the post already designed?",
  },
  {
    id: "menu-upload",
    upstream: { requestType: "Creative", taskType: "Menu (F&B, Spa)" },
    downstream: { requestType: "Web", taskType: "Menu Upload" },
    unclearPrompt: "Is the menu already designed?",
  },
];

const MAKE = /\b(create|creating|make|making|build|building|design|new)\b/i;
const LATER = /\b(send|sending|post|posting|upload|uploading|launch|launching)\b/i;

export function taskPairFor(draft: BriefDraft): TaskPair | undefined {
  return TASK_PAIRS.find((pair) => pair.upstream.requestType === draft.requestType && pair.upstream.taskType === draft.taskType)
    ?? TASK_PAIRS.find((pair) => pair.downstream.requestType === draft.requestType && pair.downstream.taskType === draft.taskType);
}

/** "Send an email" does not say whether a design already exists. "Create an email" does. */
export function designAlreadyUnclear(text: string): boolean {
  return LATER.test(text) && !MAKE.test(text);
}

export function missingForRequest(draft: BriefDraft, today = new Date()): MissingItem[] {
  const primary = listMissing(draft, today).items;
  if (!draft.companionRequestType || !draft.companionTaskType) return primary;
  const shadow: BriefDraft = {
    ...draft,
    requestType: draft.companionRequestType,
    taskType: draft.companionTaskType,
    intakeFlow: "simplified",
  };
  const extra = listMissing(shadow, today).items.filter((item) => !primary.some((have) => have.id === item.id));
  return [...primary, ...extra];
}

export function companionDraft(draft: BriefDraft): BriefDraft {
  const name = draft.requestName?.trim() || "Request";
  return {
    ...draft,
    requestType: draft.companionRequestType,
    taskType: draft.companionTaskType,
    requestName: name.toLowerCase().endsWith(" send") ? name : `${name} send`,
    novelty: undefined,
    companionRequestType: undefined,
    companionTaskType: undefined,
  };
}

/** The later task depends on the earlier task. */
export function dependencyPlan(upstreamGid: string, downstreamGid: string): { taskGid: string; dependencies: string[] } {
  return { taskGid: downstreamGid, dependencies: [upstreamGid] };
}

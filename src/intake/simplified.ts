import { designAlreadyUnclear, missingForRequest, taskPairFor } from "./dependencies.js";
import { formatEasyAsk } from "./easy-chat.js";
import { isFilled } from "./missing.js";
import {
  formatCreatorStudioReply,
  loadCreatorStudio,
  type CreatorStudioMatch,
} from "./creator-studio.js";
import {
  briefBundle,
  NOVELTY_QUESTION,
  PROPERTY_QUESTION,
  REPORTING_LANE_QUESTION,
  formatSuggestedBrief,
  newRequestApproval,
} from "./hard-path.js";
import type { BriefDraft, RequestType } from "./types.js";
import {
  concreteApprover,
  hardRequestsCreateAsana,
  inferNovelty,
  inferReportingLane,
  needsNoveltyQuestion,
  needsReportingLane,
  resolveWorkflow,
  type ReportingLane,
  type WorkNovelty,
  type WorkflowAssignment,
} from "./workflows.js";

const SKIP_PHASES = new Set([
  "template_offered",
  "awaiting_design_materials",
  "design_ready",
  "collateral_offered",
  "collateral_accepted",
  "template_accepted",
  "submitted",
  "submitting",
  "awaiting_task_completion",
  "tasks_completed",
  "awaiting_email_split",
  "awaiting_confirm",
]);

export type SimplifiedResult =
  | { kind: "ask_novelty"; prompt: string }
  | { kind: "ask_reporting_lane"; prompt: string }
  | { kind: "creator_studio"; match: CreatorStudioMatch; text: string }
  | { kind: "ask_property"; prompt: string }
  | { kind: "hard_question"; id: string; prompt: string; notice?: string }
  | { kind: "task_question"; id: string; prompt: string }
  | { kind: "hard_await_notes"; text: string }
  | { kind: "hard_brief"; text: string; createsTask: boolean }
  | { kind: "hard_done"; text: string }
  | { kind: "hard_ready"; text: string };

export interface SimplifiedState {
  phase: string;
  draft: BriefDraft;
  creatorStudioMatch?: CreatorStudioMatch | null;
  confirmVersion: number;
}

/**
 * New-or-edit, Creator Studio, then easy (return undefined and keep today's brief)
 * or hard (property if needed, three brief questions, then the key task-type questions).
 */
export function routeSimplified(state: SimplifiedState, today = new Date(), env: NodeJS.ProcessEnv = process.env): SimplifiedResult | undefined {
  if (state.phase === "creator_studio" && state.creatorStudioMatch) {
    return { kind: "creator_studio", match: state.creatorStudioMatch, text: formatCreatorStudioReply(state.creatorStudioMatch) };
  }
  if (state.phase === "brief_approved") {
    return {
      kind: "hard_done",
      text: "That brief is already approved. I didn't create an Asana task.",
    };
  }
  if (state.phase === "awaiting_brief_approval") {
    const workflow = workflowFor(state.draft, env);
    if (!workflow) return undefined;
    return {
      kind: "hard_brief",
      text: formatSuggestedBrief(state.draft, workflow),
      createsTask: hardRequestsCreateAsana(env),
    };
  }
  if (SKIP_PHASES.has(state.phase)) return undefined;

  const draft = state.draft;
  if (draft.requestType === "Creative" && draft.taskType === "Pop Up") {
    draft.requestType = "CRM & Paid";
    draft.taskType = "Pop Up";
  }
  if (draft.requestType === "Web" && (draft.taskType === "Brandfolder Upload" || draft.taskType === "Affiliate Import")) {
    delete draft.taskType;
    return undefined;
  }
  if (!draft.requestType || !draft.taskType) return undefined;

  if (needsReportingLane(draft.requestType, draft.taskType) && !draft.reportingLane) {
    const inferred = inferReportingLane(matchText(draft));
    if (inferred) draft.reportingLane = inferred;
    else {
      state.phase = "collecting";
      return { kind: "ask_reporting_lane", prompt: REPORTING_LANE_QUESTION };
    }
  }

  if (needsNoveltyQuestion(draft.requestType, draft.taskType) && !draft.novelty) {
    const inferred = inferNovelty(matchText(draft));
    if (inferred) draft.novelty = inferred;
    else {
      state.phase = "collecting";
      return { kind: "ask_novelty", prompt: NOVELTY_QUESTION };
    }
  }

  const studio = loadCreatorStudio(env).find({
    requestType: draft.requestType,
    taskType: draft.taskType,
    text: matchText(draft),
    properties: draft.properties ?? [],
  });
  if (studio) {
    state.creatorStudioMatch = studio;
    state.phase = "creator_studio";
    return { kind: "creator_studio", match: studio, text: formatCreatorStudioReply(studio) };
  }

  const workflow = workflowFor(draft, env);
  if (!workflow) return undefined;
  stampWorkflow(draft, workflow);

  if (workflow.difficulty === "easy") {
    applyEasyDefaults(draft, workflow);
    return undefined;
  }

  return advanceHard(state, workflow, today);
}

function advanceHard(
  state: SimplifiedState,
  _workflow: WorkflowAssignment,
  today: Date,
): SimplifiedResult {
  const draft = state.draft;
  if (!draft.properties || draft.properties.length === 0) {
    state.phase = "collecting";
    return { kind: "ask_property", prompt: PROPERTY_QUESTION };
  }
  const bundle = briefBundle(draft);
  if (bundle) {
    state.phase = "collecting";
    const notice = draft.managerNotified ? undefined : newRequestApproval(draft);
    draft.managerNotified = true;
    return notice
      ? { kind: "hard_question", id: bundle.id, prompt: bundle.prompt, notice }
      : { kind: "hard_question", id: bundle.id, prompt: bundle.prompt };
  }
  const pair = taskPairFor(draft);
  if (pair && draft.designReady === undefined && draft.taskType === pair.upstream.taskType) {
    if (designAlreadyUnclear(`${draft.notes ?? ""} ${draft.requestName ?? ""}`)) {
      state.phase = "collecting";
      return { kind: "task_question", id: "designReady", prompt: pair.unclearPrompt };
    }
    draft.designReady = false;
    draft.companionRequestType = pair.downstream.requestType;
    draft.companionTaskType = pair.downstream.taskType;
  }
  if (pair && draft.designReady === true && draft.taskType === pair.upstream.taskType) {
    draft.requestType = pair.downstream.requestType;
    draft.taskType = pair.downstream.taskType;
    delete draft.novelty;
    delete draft.companionRequestType;
    delete draft.companionTaskType;
  }
  if (pair && draft.designReady === false) {
    draft.companionRequestType = pair.downstream.requestType;
    draft.companionTaskType = pair.downstream.taskType;
  }
  const pending = missingForRequest(draft, today);
  if (pending.length > 0) {
    const turn = formatEasyAsk({ draft, items: pending, opening: false });
    const id = turn.askedIds.join("+");
    if (id) {
      state.phase = "collecting";
      return { kind: "task_question", id, prompt: turn.text };
    }
  }
  if (draft.companionTaskType) {
    state.phase = "awaiting_confirm";
    state.confirmVersion += 1;
    const place = draft.properties?.[0] ?? "this";
    return {
      kind: "hard_ready",
      text: `I can file this ${place} ${draft.requestName?.trim() || "request"}. Click Confirm and I'll create it.`,
    };
  }
  state.phase = "brief_approved";
  return {
    kind: "hard_done",
    text: `${newRequestApproval(draft)} I have the answers in this thread. Nothing was filed in Asana.`,
  };
}

export function approveHardBrief(state: SimplifiedState, env: NodeJS.ProcessEnv = process.env): { fileAsana: boolean; text: string } {
  state.draft.hardBriefApproved = true;
  if (!hardRequestsCreateAsana(env)) {
    state.phase = "brief_approved";
    return {
      fileAsana: false,
      text: "Brief approved. I didn't create an Asana task. HARD_REQUESTS_CREATE_ASANA stays off until the team decides.",
    };
  }
  state.phase = "awaiting_confirm";
  return { fileAsana: true, text: "" };
}

function workflowFor(draft: BriefDraft, env: NodeJS.ProcessEnv): WorkflowAssignment | undefined {
  return resolveWorkflow({
    requestType: draft.requestType as RequestType | undefined,
    taskType: draft.taskType,
    novelty: draft.novelty as WorkNovelty | undefined,
    reportingLane: draft.reportingLane as ReportingLane | undefined,
    properties: draft.properties,
    requesterName: draft.requesterName,
    env,
  });
}

function stampWorkflow(draft: BriefDraft, workflow: WorkflowAssignment): void {
  draft.workflowDepartment = workflow.department;
  draft.workflowBucket = workflow.bucket;
  draft.workflowOwner = workflow.owner;
  draft.workflowApprover = workflow.approverTodo ? "TODO" : workflow.approver;
}

function applyEasyDefaults(draft: BriefDraft, workflow: WorkflowAssignment): void {
  const named = concreteApprover(workflow);
  if (named && !draft.approver?.trim()) draft.approver = named;
  if (draft.requestType === "CRM & Paid" && draft.taskType === "Pop Up" && !draft.whereItGoesLive) {
    draft.whereItGoesLive = "Klaviyo";
  }
}

function matchText(draft: BriefDraft): string {
  return [
    draft.requestName ?? "",
    draft.notes ?? "",
    draft.taskType ?? "",
    ...Object.values(draft.followUps ?? {}),
  ].join(" ");
}

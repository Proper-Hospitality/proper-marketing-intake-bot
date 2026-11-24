import { isFilled } from "./missing.js";
import {
  formatCreatorStudioReply,
  loadCreatorStudio,
  type CreatorStudioMatch,
} from "./creator-studio.js";
import {
  HARD_QUESTIONS,
  NOVELTY_QUESTION,
  REPORTING_LANE_QUESTION,
  formatSuggestedBrief,
  handoffText,
  notesPrompt,
} from "./hard-path.js";
import { fallbackProposal, type KickoffSlot, type ScheduleProposal } from "./schedule.js";
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
  | { kind: "hard_question"; id: string; prompt: string }
  | { kind: "hard_handoff"; text: string }
  | { kind: "hard_schedule"; proposal: ScheduleProposal }
  | { kind: "hard_await_notes"; text: string }
  | { kind: "hard_brief"; text: string; createsTask: boolean }
  | { kind: "hard_done"; text: string };

export interface SimplifiedState {
  phase: string;
  draft: BriefDraft;
  kickoffSlots?: KickoffSlot[];
  creatorStudioMatch?: CreatorStudioMatch | null;
  confirmVersion: number;
}

/**
 * New-or-edit, Creator Studio, then easy (return undefined and keep today's brief)
 * or hard (three questions, handoff, kickoff, notes, suggested brief).
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

  return advanceHard(state, workflow, today, env);
}

function advanceHard(
  state: SimplifiedState,
  workflow: WorkflowAssignment,
  today: Date,
  env: NodeJS.ProcessEnv,
): SimplifiedResult {
  const draft = state.draft;
  for (const question of HARD_QUESTIONS) {
    const value = draft[question.field];
    if (!isFilled(value)) {
      state.phase = "collecting";
      return { kind: "hard_question", id: question.id, prompt: question.prompt };
    }
  }
  if (!isFilled(draft.kickoffTeam)) {
    state.phase = "awaiting_team";
    return { kind: "hard_handoff", text: handoffText(draft, workflow) };
  }
  if (!isFilled(draft.kickoffSlot)) {
    const proposal = fallbackProposal(today);
    state.kickoffSlots = proposal.slots;
    state.phase = "awaiting_kickoff";
    return { kind: "hard_schedule", proposal };
  }
  if (!isFilled(draft.meetingNotes)) {
    state.phase = "awaiting_notes";
    return { kind: "hard_await_notes", text: notesPrompt(draft.kickoffSlot ?? "the kickoff") };
  }
  if (state.phase !== "awaiting_brief_approval") {
    state.phase = "awaiting_brief_approval";
    state.confirmVersion += 1;
  }
  return {
    kind: "hard_brief",
    text: formatSuggestedBrief(draft, workflow),
    createsTask: hardRequestsCreateAsana(env),
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

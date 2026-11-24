import type { BriefDraft } from "./types.js";
import {
  BRAND_LEADS_TOGETHER,
  brandLeadFor,
  type WorkflowAssignment,
} from "./workflows.js";

export const NOVELTY_QUESTION = "Is this new, or an edit of something that already exists?";
export const REPORTING_LANE_QUESTION = "Is this paid media reporting, or CRM reporting?";
export const NOTES_REMINDER = "Paste the notes from that conversation in this thread. A sentence or two on what you agreed is enough.";

export const HARD_QUESTIONS = [
  {
    id: "businessProblem",
    field: "businessProblem",
    prompt: "What's the business problem this solves?",
  },
  {
    id: "successLooksLike",
    field: "successLooksLike",
    prompt: "What does success look like?",
  },
  {
    id: "budget",
    field: "budget",
    prompt: "Is there any budget?",
  },
] as const;

export type HardQuestionId = (typeof HARD_QUESTIONS)[number]["id"];

export function hardQuestionById(id: string | undefined): (typeof HARD_QUESTIONS)[number] | undefined {
  return HARD_QUESTIONS.find((question) => question.id === id);
}

/** Slack mention when we know the submitter's member id. Otherwise their name. */
export function submitterTag(draft: BriefDraft): string {
  if (draft.requesterSlackId) return `<@${draft.requesterSlackId}>`;
  const name = draft.requesterName?.trim();
  return name || "the submitter";
}

export function handoffText(draft: BriefDraft, workflow: WorkflowAssignment): string {
  const lead = brandLeadFor(draft.properties);
  const suggest = workflow.suggestions.join(", ");
  const note = workflow.ownerNote ? `\n${workflow.ownerNote}` : "";
  return [
    `This is a hard request (${workflow.bucket}, ${workflow.department}).`,
    "",
    `${BRAND_LEADS_TOGETHER} are the brand leads. This property goes to ${lead.name}.`,
    "",
    `I'd suggest ${suggest}.`,
    `Owner: ${workflow.owner}. Approver: ${approverLine(workflow)}.${note}`,
    "",
    `${lead.name} will connect with ${submitterTag(draft)}. After you've connected, paste the notes in this thread and I'll draft a brief for approval. Nothing is filed in Asana yet.`,
  ].join("\n");
}

export function approverLine(workflow: WorkflowAssignment): string {
  if (workflow.approverTodo) return "TODO (confirm with Kinsey)";
  return workflow.approver;
}

export function formatSuggestedBrief(draft: BriefDraft, workflow: WorkflowAssignment): string {
  const team = draft.kickoffTeam?.trim() || workflow.suggestions.join(", ");
  const scope = [
    draft.requestName,
    draft.taskType ? `${workflow.department} / ${workflow.bucket} / ${draft.taskType}` : undefined,
    team ? `Suggested team: ${team}` : undefined,
    draft.meetingNotes ? `From the conversation: ${draft.meetingNotes}` : undefined,
  ].filter(Boolean);
  const timeline = draft.requestedCompletionDate
    ? `Requested live date: ${draft.requestedCompletionDate}`
    : "Live date: set when you connect";
  return [
    "Suggested brief for the brand manager to approve.",
    "Nothing is filed in Asana until that decision is turned on.",
    "",
    `Business problem: ${draft.businessProblem ?? ""}`,
    `Success: ${draft.successLooksLike ?? ""}`,
    `Budget: ${draft.budget ?? ""}`,
    `Scope: ${scope.join(". ")}`,
    `Owner: ${workflow.owner}`,
    `Approver: ${approverLine(workflow)}`,
    `Timeline: ${timeline}`,
  ].join("\n");
}

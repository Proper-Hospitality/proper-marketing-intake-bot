import type { BriefDraft } from "./types.js";
import type { KickoffSlot, ScheduleProposal } from "./schedule.js";
import { formatScheduleMessage, parseSlotChoice } from "./schedule.js";
import {
  BRAND_LEADS_TOGETHER,
  brandLeadFor,
  type WorkflowAssignment,
} from "./workflows.js";

export const NOVELTY_QUESTION = "Is this new, or an edit of something that already exists?";
export const REPORTING_LANE_QUESTION = "Is this paid media reporting, or CRM reporting?";

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

export function handoffText(draft: BriefDraft, workflow: WorkflowAssignment): string {
  const lead = brandLeadFor(draft.properties);
  const suggest = workflow.suggestions.join(", ");
  const note = workflow.ownerNote ? `\n${workflow.ownerNote}` : "";
  return [
    `This is a hard request (${workflow.bucket}, ${workflow.department}).`,
    "",
    `${BRAND_LEADS_TOGETHER} are the brand leads. This property goes to ${lead.name}.`,
    "",
    `${lead.name}, who should be on a 15-minute kickoff? I'd suggest ${suggest}.`,
    `Owner: ${workflow.owner}. Approver: ${approverLine(workflow)}.${note}`,
    "",
    "Reply with the people to include.",
  ].join("\n");
}

export function approverLine(workflow: WorkflowAssignment): string {
  if (workflow.approverTodo) return "TODO (confirm with Kinsey)";
  return workflow.approver;
}

export function notesPrompt(slotLabel: string): string {
  return `I'll aim for ${slotLabel}. After the kickoff, paste the meeting notes here and I'll draft a brief for approval. Nothing is filed in Asana yet.`;
}

export function formatSuggestedBrief(draft: BriefDraft, workflow: WorkflowAssignment): string {
  const scope = [
    draft.requestName,
    draft.taskType ? `${workflow.department} / ${workflow.bucket} / ${draft.taskType}` : undefined,
    draft.kickoffTeam ? `Team: ${draft.kickoffTeam}` : undefined,
    draft.meetingNotes ? `From the kickoff: ${draft.meetingNotes}` : undefined,
  ].filter(Boolean);
  const timeline = [
    draft.kickoffSlot ? `Kickoff: ${draft.kickoffSlot}` : undefined,
    draft.requestedCompletionDate ? `Requested live date: ${draft.requestedCompletionDate}` : "Live date: set with the team at the kickoff",
  ].filter(Boolean);
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
    `Timeline: ${timeline.join(". ")}`,
  ].join("\n");
}

export function rememberTeam(text: string, suggestions: string[]): string {
  const clean = text.trim();
  if (/^(suggest|the suggestions|your suggestion|whoever you suggested)\b/i.test(clean)) {
    return suggestions.join(", ");
  }
  return clean;
}

export function chooseSlot(slots: KickoffSlot[], text: string): KickoffSlot | undefined {
  return parseSlotChoice(text, slots);
}

export function scheduleText(proposal: ScheduleProposal): string {
  return formatScheduleMessage(proposal);
}

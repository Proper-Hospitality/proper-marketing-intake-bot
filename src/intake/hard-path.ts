import { plainFollowUp } from "./easy-chat.js";
import { isFilled } from "./missing.js";
import type { BriefDraft } from "./types.js";
import { followUpsForFlow } from "./question-tree.js";
import { brandLeadFor, type WorkflowAssignment } from "./workflows.js";

export const NOVELTY_QUESTION = "Is this new, or an edit of something that already exists?";
export const REPORTING_LANE_QUESTION = "Is this paid media reporting, or CRM reporting?";
export const NOTES_REMINDER = "Paste the notes from that conversation in this thread. A sentence or two on what you agreed is enough.";

export const HARD_QUESTIONS = [
  {
    id: "businessProblem",
    field: "businessProblem",
    prompt: "What do you need this for? For example, a promotion, an event, or to drive bookings.",
  },
  {
    id: "successLooksLike",
    field: "successLooksLike",
    prompt: "How will we know it worked? For example, more bookings, sign-ups, or clicks.",
  },
  {
    id: "budget",
    field: "budget",
    prompt: "Is there a budget for this? If not, just say no.",
  },
] as const;

export type HardQuestionId = (typeof HARD_QUESTIONS)[number]["id"];

export function hardQuestionById(id: string | undefined): (typeof HARD_QUESTIONS)[number] | undefined {
  return HARD_QUESTIONS.find((question) => question.id === id);
}

/** Lines for the first new-request reply. Budget is always in that list. */
export const BRIEF_LINES: Record<HardQuestionId, string> = {
  businessProblem: HARD_QUESTIONS[0].prompt,
  successLooksLike: HARD_QUESTIONS[1].prompt,
  budget: HARD_QUESTIONS[2].prompt,
};

export function missingBriefQuestions(draft: BriefDraft): Array<(typeof HARD_QUESTIONS)[number]> {
  return HARD_QUESTIONS.filter((question) => !isFilled(draft[question.field]));
}

export function briefBundle(draft: BriefDraft): { id: string; prompt: string } | undefined {
  const missing = missingBriefQuestions(draft);
  if (missing.length === 0) return undefined;
  const lines = missing.map((question) => BRIEF_LINES[question.id]);
  const prompt = lines.length === 1 ? lines[0] : lines.map((line) => `- ${line}`).join("\n");
  return { id: missing.map((question) => question.id).join("+"), prompt };
}

/** Map a reply onto the brief questions still open. Never invents a budget. */
export function recordBriefAnswers(draft: BriefDraft, ids: string[], text: string): boolean {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  lines.forEach((line, index) => {
    const id = ids[index];
    const question = hardQuestionById(id);
    if (question) draft[question.field] = line;
  });
  return true;
}

export const PROPERTY_QUESTION = "Which property is this for? A code like SMB or SMP is perfect. I need it to ask the right brand manager.";

/** @mention the brand manager for this property. Proper and By Proper, including Lake Tahoe, go to DeeDee. Collective goes to Koral. */
export function newRequestApproval(draft: BriefDraft, env: NodeJS.ProcessEnv = process.env): string {
  const lead = brandLeadFor(draft.properties, env);
  return `This is a new request, so it needs approval from <@${lead.id}>.`;
}

export interface TaskQuestion {
  id: string;
  prompt: string;
}

/** Required questions from the classic question tree for this task type. Optional fields stay off this short list. */
export function keyTaskQuestions(draft: BriefDraft): TaskQuestion[] {
  if (!draft.requestType || !draft.taskType) return [];
  try {
    return followUpsForFlow(draft.requestType, draft.taskType, "simplified")
      .filter((field) => field.required)
      .map((field) => ({
        id: `followup:${field.label}`,
        prompt: plainFollowUp(field.label, draft),
      }));
  } catch {
    return [];
  }
}

export function approverLine(workflow: WorkflowAssignment): string {
  if (workflow.approverTodo || workflow.approver === "TODO") return "still to be confirmed with Kinsey";
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

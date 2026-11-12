import { routingSignOff } from "../intake/catalog.js";
import { MAX_REVIEW_ROUNDS } from "./config.js";

export interface ReviewParty {
  taskGid: string;
  taskName: string;
  taskUrl?: string;
  property: string;
  approverName: string;
  approverSlackId: string;
  /** The person who did the work. They are never the approver. */
  workerName?: string;
}

export interface ReviewSession {
  taskGid: string;
  taskName: string;
  taskUrl?: string;
  property: string;
  link: string;
  approverName: string;
  approverSlackId: string;
  workerName?: string;
  /** Feedback comments already posted. */
  round: number;
  phase: "awaiting_choice" | "awaiting_feedback" | "changes_sent" | "approved" | "escalated";
}

export interface ReviewTask {
  gid: string;
  name?: string;
  permalink_url?: string;
  completed?: boolean;
  assignee?: { name?: string; gid?: string };
  memberships?: Array<{ section?: { name?: string }; project?: { name?: string } }>;
  custom_fields?: Array<{ name?: string; display_value?: string | null; text_value?: string | null }>;
}

export function deliverableLink(task: ReviewTask): string | undefined {
  const field = (task.custom_fields ?? []).find((item) => /final deliverable link/i.test(item.name ?? ""));
  const value = (field?.display_value || field?.text_value || "").trim();
  return value || undefined;
}

export function inReview(task: ReviewTask): boolean {
  return (task.memberships ?? []).some((membership) => /review/i.test(membership.section?.name ?? ""));
}

/** A review DM is sent only when the task is in Review and the link is filled in. */
export function readyForReview(task: ReviewTask): { link: string } | undefined {
  if (task.completed) return undefined;
  if (!inReview(task)) return undefined;
  const link = deliverableLink(task);
  if (!link) return undefined;
  return { link };
}

export function workerIsApprover(party: ReviewParty, task: ReviewTask): boolean {
  const worker = (task.assignee?.name || party.workerName || "").trim().toLowerCase();
  const approver = party.approverName.trim().toLowerCase();
  if (!worker || !approver) return false;
  return worker === approver;
}

export function reviewDmText(input: { taskName: string; property: string; link: string }): string {
  return [
    `${input.property ? `${input.property} — ` : ""}${input.taskName} is ready for your review.`,
    "",
    input.link,
    "",
    "Reply *approve*, or tell me what should change.",
  ].join("\n");
}

export function feedbackComment(name: string, round: number, text: string): string {
  return `Feedback from ${name} via Slack (round ${round}):\n${text.trim()}`;
}

export function approvalComment(name: string, when: Date): string {
  const stamp = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(when);
  return `Approved by ${name} via Slack on ${stamp}. A person on the team can mark this Done.`;
}

export function escalationComment(property: string): string {
  const signOff = routingSignOff(property ? [property] : []);
  return `Escalated after ${MAX_REVIEW_ROUNDS} revision rounds. ${signOff.signOff}. A person needs to take this from here.`;
}

export type ReviewAction =
  | { kind: "ask"; session: ReviewSession; text: string }
  | { kind: "comment"; session: ReviewSession; text: string; comment: string }
  | { kind: "escalate"; session: ReviewSession; text: string; comment: string }
  | { kind: "approve"; session: ReviewSession; text: string; comment: string }
  | { kind: "ignore"; session: ReviewSession };

export function applyReviewReply(session: ReviewSession, text: string, when = new Date()): ReviewAction {
  const said = text.trim();
  if (session.phase === "approved" || session.phase === "escalated") {
    return { kind: "ignore", session };
  }
  if (session.phase === "awaiting_feedback") {
    if (session.round >= MAX_REVIEW_ROUNDS) {
      const next = { ...session, phase: "escalated" as const };
      return {
        kind: "escalate",
        session: next,
        comment: escalationComment(session.property),
        text: `That's ${MAX_REVIEW_ROUNDS} rounds of changes. I've flagged the task for a person on the ${routingSignOff(session.property ? [session.property] : []).bucket ?? "routing"} side to take it.`,
      };
    }
    const round = session.round + 1;
    const next = { ...session, round, phase: "changes_sent" as const };
    return {
      kind: "comment",
      session: next,
      comment: feedbackComment(session.approverName, round, said),
      text: round >= MAX_REVIEW_ROUNDS
        ? "I sent that to the task. That's the last round I can pass along. The next step needs a person on the team."
        : "I sent that to the task. The team will see it in Asana.",
    };
  }
  if (isApproval(said)) {
    const next = { ...session, phase: "approved" as const };
    return {
      kind: "approve",
      session: next,
      comment: approvalComment(session.approverName, when),
      text: "I recorded your approval on the task. Someone on the team will mark it Done.",
    };
  }
  if (isChangeRequest(said)) {
    if (session.round >= MAX_REVIEW_ROUNDS) {
      const next = { ...session, phase: "escalated" as const };
      return {
        kind: "escalate",
        session: next,
        comment: escalationComment(session.property),
        text: `That's ${MAX_REVIEW_ROUNDS} rounds already. I've flagged the task for a person to take it.`,
      };
    }
    const next = { ...session, phase: "awaiting_feedback" as const };
    return { kind: "ask", session: next, text: "What should change?" };
  }
  return { kind: "ignore", session };
}

export function isApproval(text: string): boolean {
  return /^(approve|approved|looks good|lgtm|yes|ship it)\b/i.test(text.trim());
}

export function isChangeRequest(text: string): boolean {
  return /^(changes|request changes|change|request change)\b/i.test(text.trim());
}

export function parseApproverChoice(
  text: string,
  requester: { id?: string; name?: string },
): { name: string; slackId?: string; source: "requester" | "named" } | undefined {
  const trimmed = text.trim();
  if (/^(me|i am|i'm|i’ll|i will|yes|i'?ll sign off|i am the approver)\b/i.test(trimmed)) {
    if (!requester.name) return undefined;
    return { name: requester.name, slackId: requester.id, source: "requester" };
  }
  const named = trimmed.match(/^([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){0,2})\s*$/);
  if (!named?.[1]) return undefined;
  return { name: named[1].replace(/[.,]+$/, ""), source: "named" };
}

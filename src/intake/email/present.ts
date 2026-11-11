import { formatPropertyQuestion, formatQuestions, formatSummary, formatTemplateOffer } from "../brief.js";
import { rushExplanation } from "../rush.js";
import type { FlowOutcome } from "../flow.js";
import type { ConversationState } from "../../store/types.js";
import type { EmailIntakeState } from "./types.js";

export interface EmailReply {
  text: string;
  confirm?: { version: number };
}

export function addressName(formatted: string | undefined): string | undefined {
  if (!formatted) return undefined;
  const display = formatted.split("<")[0].replace(/,.*/, "").trim();
  const first = display.split(/\s+/).filter(Boolean)[0];
  if (!first || first.toLowerCase() === "unknown") return undefined;
  return first;
}

export function formatSplitProposal(state: ConversationState): string {
  const email = state.emailIntake;
  if (!email) return "";
  const who = addressName(email.forwarder) ?? "Hi";
  const lines = [
    `${who}, I read this ${email.forwarded ? "forwarded " : ""}email.`,
    "",
    `*Original requester:* ${email.originalRequester}`,
    email.forwarded ? `*Forwarded by:* ${email.forwarder}` : `*Sent by:* ${email.forwarder}`,
    `*Subject:* ${email.subject}`,
    "",
    `This email has ${email.proposals.length} separate asks. I would file them as separate briefs so each one becomes its own Asana task:`,
    "",
  ];
  email.proposals.forEach((proposal, index) => {
    const route = proposal.requestType && proposal.taskType
      ? `${proposal.requestType} → ${proposal.taskType}`
      : "I'll ask which request type fits";
    lines.push(`${index + 1}. *${proposal.title}* — ${route}`);
    lines.push(truncate(proposal.detail, 900));
    lines.push("");
  });
  lines.push("Reply *yes* to split them, or *keep it as one* if you want a single task. Nothing is filed until you confirm each brief.");
  return lines.join("\n");
}

export function presentEmailStep(state: ConversationState, outcome: FlowOutcome, today: Date): EmailReply {
  const header = emailStepHeader(state);
  if (outcome.kind === "ask") {
    const item = outcome.missing.items[0];
    if (item) {
      state.lastAskedId = item.id;
      state.lastAskedLabel = item.label;
    }
    const question = formatQuestions({
      userId: state.slackUserId,
      who: state.slackUserId ? undefined : addressName(state.emailIntake?.forwarder),
      items: item ? [item] : [],
      warnings: item && /timing|date|late/i.test(item.id + item.label) ? outcome.missing.warnings : [],
      draft: state.draft,
    });
    const preface = outcome.preface ? `${outcome.preface}\n\n` : "";
    return { text: `${header}\n\n${preface}${question}`.trim() };
  }
  if (outcome.kind === "confirm") {
    const summary = formatSummary({
      draft: state.draft,
      warnings: outcome.missing.warnings,
      templateOffer: state.templateOffer,
      duplicates: state.duplicates,
    });
    const preface = outcome.preface ? `${outcome.preface}\n\n` : "";
    return {
      text: `${header}\n\n${preface}${summary}`.trim(),
      confirm: { version: state.confirmVersion },
    };
  }
  if (outcome.kind === "rush_required") {
    return { text: `${header}\n\n${rushExplanation(outcome.reason, outcome.date)}` };
  }
  if (outcome.kind === "need_property") {
    return { text: `${header}\n\n${formatPropertyQuestion(state.slackUserId)}` };
  }
  if (outcome.kind === "offer_template") {
    return { text: `${header}\n\n${formatTemplateOffer(outcome.match)}` };
  }
  if (outcome.kind === "invalid") {
    return { text: `${header}\n\n${outcome.errors.join("\n")}`.trim() };
  }
  return { text: header };
}

export function emailStepHeader(state: ConversationState): string {
  const email = state.emailIntake;
  const draft = state.draft;
  const lines: string[] = [];
  if (email?.mode === "split" && email.proposals.length > 1) {
    const n = (email.activeIndex ?? 0) + 1;
    lines.push(`Brief ${n} of ${email.proposals.length} from this email. Nothing is filed until you click *Confirm*.`);
  } else {
    lines.push("Draft from the email. Nothing is filed until you click *Confirm*.");
  }
  lines.push("");
  if (draft.requestName) lines.push(`*${draft.requestName}*`);
  if (draft.requestType && draft.taskType) lines.push(`${draft.requestType} → ${draft.taskType}`);
  if (email?.originalRequester) lines.push(`Original requester: ${email.originalRequester}`);
  if (email?.forwarded) lines.push(`Forwarded by: ${email.forwarder}`);
  else if (email?.forwarder) lines.push(`Sent by: ${email.forwarder}`);
  if (email?.subject) lines.push(`Subject: ${email.subject}`);
  const active = email?.proposals[email.activeIndex ?? 0];
  if (active?.detail) {
    lines.push("");
    lines.push(truncate(active.detail, 1200));
  }
  return lines.join("\n");
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

export function promptEmailNote(email: EmailIntakeState | undefined): string {
  if (!email) return "";
  const which = email.mode === "split"
    ? `This is brief ${(email.activeIndex ?? 0) + 1} of ${email.proposals.length}. Do not pull the other asks into this task.`
    : "The person asked to keep every ask in this email on one brief.";
  return `
## Forwarded email
This thread started from an email: ${email.subject}.
Original requester: ${email.originalRequester}.
${email.forwarded ? `Forwarded by: ${email.forwarder}.` : `Sent by: ${email.forwarder}.`}
Keep the original requester on the draft unless the person in this thread corrects the requester.
Request type and task type are already set. Do not change them unless the person corrects the type.
${which}
`;
}

import { formatPropertyQuestion, formatQuestions, formatSummary, formatTemplateOffer } from "../brief.js";
import { propertyPhrase } from "../catalog.js";
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
  const display = partyName(formatted);
  const first = display?.split(/\s+/).filter(Boolean)[0];
  if (!first || first.toLowerCase() === "unknown") return undefined;
  return first;
}

export function partyName(formatted: string | undefined): string | undefined {
  if (!formatted) return undefined;
  const display = formatted.split("<")[0].replace(/,.*/, "").trim();
  if (!display || display.toLowerCase() === "unknown") return undefined;
  return display;
}

/** Who the email thread is talking to: the original sender, not the forwarder. */
export function emailAddressee(state: ConversationState): { userId?: string; who?: string } {
  const email = state.emailIntake;
  if (!email) return { userId: state.slackUserId };
  if (email.requesterSlackId) return { userId: email.requesterSlackId };
  return { who: partyName(email.originalRequester) ?? addressName(email.originalRequester) ?? "Hi" };
}

export function formatEmailPropertyConfirm(state: ConversationState): string | undefined {
  const email = state.emailIntake;
  if (!email || email.propertyConfirmed) return undefined;
  const inferred = email.inferredProperties ?? [];
  if (inferred.length === 0) return undefined;
  const name = spokenTo(state);
  if (inferred.length === 1) {
    return `${name} — this is ${propertyPhrase(inferred[0] ?? "")}, right? Say yes, or name a different property.`;
  }
  return `${name} — this mentions ${inferred.map((code) => propertyPhrase(code)).join(" and ")}. Which should I file?`;
}

export function formatSplitProposal(state: ConversationState): string {
  const email = state.emailIntake;
  if (!email) return "";
  const who = spokenTo(state);
  const forwarded = email.forwarded ? `${partyName(email.forwarder) ?? "Someone"} forwarded this. ` : "";
  const property = email.inferredProperties?.length === 1
    ? ` It looks like ${propertyPhrase(email.inferredProperties[0] ?? "")}.`
    : "";
  const lines = [
    `${who} — ${forwarded}I read ${email.proposals.length} separate asks in this email.${property} I'd file each as its own request:`,
    "",
  ];
  email.proposals.forEach((proposal, index) => {
    const route = proposal.requestType && proposal.taskType
      ? `${proposal.requestType} → ${proposal.taskType}`
      : "I'll ask which request type fits";
    lines.push(`${index + 1}. *${proposal.title}* — ${route}`);
    if (proposal.summary) lines.push(proposal.summary);
    lines.push("");
  });
  lines.push("Reply *yes* to split them, or *keep it as one* for a single task. Nothing is filed until you confirm.");
  return lines.join("\n");
}

export function presentEmailStep(
  state: ConversationState,
  outcome: FlowOutcome,
  _today: Date,
  options?: { intro?: boolean },
): EmailReply {
  const preface = stepPreface(state, options?.intro);
  const property = wantsProperty(outcome) ? formatEmailPropertyConfirm(state) : undefined;
  if (property) {
    state.lastAskedId = "properties";
    state.lastAskedLabel = "Property";
    return { text: joinParts(preface, property) };
  }
  if (outcome.kind === "ask") {
    const item = outcome.missing.items[0];
    if (item) {
      state.lastAskedId = item.id;
      state.lastAskedLabel = item.label;
    }
    const addressed = emailAddressee(state);
    const question = formatQuestions({
      userId: addressed.who ? undefined : addressed.userId,
      who: addressed.who,
      items: item ? [item] : [],
      warnings: item && /timing|date|late/i.test(item.id + item.label) ? outcome.missing.warnings : [],
      draft: state.draft,
      acknowledge: Boolean(state.answerTrail?.length),
    });
    const lead = outcome.preface ? `${outcome.preface}\n\n${question}` : question;
    return { text: joinParts(preface, lead) };
  }
  if (outcome.kind === "confirm") {
    const summary = formatSummary({
      draft: state.draft,
      warnings: outcome.missing.warnings,
      templateOffer: state.templateOffer,
      duplicates: state.duplicates,
    });
    const lead = outcome.preface ? `${outcome.preface}\n\n${summary}` : summary;
    return {
      text: joinParts(preface, lead),
      confirm: { version: state.confirmVersion },
    };
  }
  if (outcome.kind === "rush_required") {
    return { text: joinParts(preface, rushExplanation(outcome.reason, outcome.date)) };
  }
  if (outcome.kind === "need_property") {
    const addressed = emailAddressee(state);
    return { text: joinParts(preface, formatPropertyQuestion(addressed.userId, addressed.who)) };
  }
  if (outcome.kind === "offer_template") {
    return { text: joinParts(preface, formatTemplateOffer(outcome.match)) };
  }
  if (outcome.kind === "invalid") {
    return { text: joinParts(preface, outcome.errors.join("\n")) };
  }
  return { text: preface || "Tell me how you want to handle this email. Nothing is filed until you confirm." };
}

function spokenTo(state: ConversationState): string {
  const addressed = emailAddressee(state);
  if (addressed.who) return addressed.who;
  if (addressed.userId) return `<@${addressed.userId}>`;
  return "Hi";
}

function wantsProperty(outcome: FlowOutcome): boolean {
  if (outcome.kind === "need_property") return true;
  return outcome.kind === "ask" && outcome.missing.items[0]?.id === "properties";
}

function stepPreface(state: ConversationState, intro?: boolean): string {
  const email = state.emailIntake;
  if (!email) return "";
  const lines: string[] = [];
  if (email.mode === "split" && email.proposals.length > 1) {
    const n = (email.activeIndex ?? 0) + 1;
    const proposal = email.proposals[email.activeIndex ?? 0];
    const route = proposal?.requestType && proposal.taskType ? ` — ${proposal.requestType} → ${proposal.taskType}` : "";
    lines.push(`Brief ${n} of ${email.proposals.length}${proposal?.title ? `: *${proposal.title}*` : ""}${route}.`);
  }
  if (intro) lines.push(briefIntro(state));
  return lines.join("\n\n");
}

function briefIntro(state: ConversationState): string {
  const email = state.emailIntake;
  if (!email) return "";
  const proposal = email.proposals[email.activeIndex ?? 0];
  const who = spokenTo(state);
  const summary = proposal?.summary || proposal?.title || "I read the request in this email";
  if (email.mode === "split" && email.proposals.length > 1) {
    return `${who} — I'll start with this one. Nothing is filed until you confirm.`;
  }
  const forwarded = email.forwarded ? ` ${partyName(email.forwarder) ?? "Someone"} forwarded it.` : "";
  const route = proposal?.requestType && proposal.taskType
    ? ` I'd file this as ${proposal.requestType} → ${proposal.taskType}.`
    : "";
  return `${who} — ${summary}${route}${forwarded} Nothing is filed until you confirm.`;
}

function joinParts(...parts: Array<string | undefined>): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join("\n\n");
}

export function promptEmailNote(email: EmailIntakeState | undefined): string {
  if (!email) return "";
  const which = email.mode === "split"
    ? `This is brief ${(email.activeIndex ?? 0) + 1} of ${email.proposals.length}. Do not pull the other asks into this task.`
    : email.proposals.length > 1
      ? "The person asked to keep every ask in this email on one brief."
      : "This email is one request.";
  const property = email.propertyConfirmed
    ? ""
    : email.inferredProperties?.length
      ? `The app will ask them to confirm ${email.inferredProperties.map((code) => propertyPhrase(code)).join(", ")}. Do not ask an open-ended property list.`
      : "";
  return `
## Forwarded email
This thread started from an email: ${email.subject}.
Original requester: ${email.originalRequester}.
${email.forwarded ? `Forwarded by: ${email.forwarder}.` : `Sent by: ${email.forwarder}.`}
Talk to the original requester, not the person who forwarded the email. Address that requester by name or @mention.
Keep the original requester on the draft unless the person in this thread corrects the requester.
Request type and task type are already set. Do not change them unless the person corrects the type.
${property}
${which}
`;
}

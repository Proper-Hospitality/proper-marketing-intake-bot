import { formatNeedsList } from "../ask-text.js";
import { formatQuestions, formatSummary, formatTemplateOffer } from "../brief.js";
import { greet } from "../../slack/mentions.js";
import { propertyPhrase } from "../catalog.js";
import { rushExplanation } from "../rush.js";
import type { FlowOutcome } from "../flow.js";
import type { ConversationState } from "../../store/types.js";
import type { EmailIntakeState, EmailProposal } from "./types.js";

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
  if (inferred.length === 1) {
    return `This is ${propertyPhrase(inferred[0] ?? "")}, right? Say yes, or name a different property.`;
  }
  return `I see ${inferred.map((code) => propertyPhrase(code)).join(" and ")}. Which should I file?`;
}

export function formatSplitProposal(state: ConversationState): string {
  const email = state.emailIntake;
  if (!email) return "";
  const heard = heardSentence(email.proposals);
  const property = email.inferredProperties?.length === 1
    ? ` This looks like ${propertyPhrase(email.inferredProperties[0] ?? "")}.`
    : "";
  const lines = [
    `${greeting(state)} Thanks for sending this over. ${forwardNote(email)}${heard}${property}`,
    "",
    "I'd file these separately so each one gets its own task:",
    "",
  ];
  email.proposals.forEach((proposal, index) => {
    const route = proposal.requestType && proposal.taskType
      ? ` (${proposal.requestType}, ${proposal.taskType})`
      : "";
    lines.push(`${index + 1}. ${proposal.title}${route}`);
  });
  lines.push(
    "",
    "Want me to split them? Reply yes, or say keep it as one.",
    "If you don't have an answer later, say skip or not sure. Say back to change the last one.",
    "Nothing gets filed until you say so.",
  );
  return lines.join("\n");
}

export function presentEmailStep(
  state: ConversationState,
  outcome: FlowOutcome,
  _today: Date,
  options?: { intro?: boolean },
): EmailReply {
  const preface = stepPreface(state, options?.intro);
  const property = wantsProperty(outcome) && (outcome.kind !== "ask" || outcome.missing.items.length <= 1)
    ? formatEmailPropertyConfirm(state)
    : undefined;
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
    const chat = state.intakePace === "chat" || outcome.missing.items.length <= 1;
    if (!chat) {
      state.lastAskedId = "batch";
      state.lastAskedLabel = "A few details";
      const list = formatNeedsList({
        items: outcome.missing.items,
        draft: state.draft,
        opening: (state.answerTrail ?? []).length === 0,
        duplicates: state.duplicates,
      });
      const hinted = state.emailIntake?.inferredProperties?.length === 1 && !state.draft.properties?.length
        ? `This looks like ${propertyPhrase(state.emailIntake.inferredProperties[0] ?? "")}.\n\n${list}`
        : list;
      return { text: joinParts(preface, outcome.preface, hinted) };
    }
    const question = formatQuestions({
      items: item ? [item] : [],
      warnings: item && /timing|date|late/i.test(item.id + item.label) ? outcome.missing.warnings : [],
      draft: state.draft,
      acknowledge: Boolean(state.answerTrail?.length),
      ackFor: state.answerTrail?.at(-1),
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
    return { text: joinParts(preface, "Which property is this for? A code like SMP or LTP is perfect. I check for a template before asking for the rest.") };
  }
  if (outcome.kind === "offer_template") {
    return { text: joinParts(preface, formatTemplateOffer(outcome.match)) };
  }
  if (outcome.kind === "invalid") {
    return { text: joinParts(preface, outcome.errors.join("\n")) };
  }
  return { text: preface || "Tell me how you want to handle this email. Nothing is filed until you confirm." };
}

function greeting(state: ConversationState): string {
  const addressed = emailAddressee(state);
  const name = partyName(state.emailIntake?.originalRequester) ?? addressed.who;
  return greet({ userId: addressed.userId, name });
}

function forwardNote(email: EmailIntakeState): string {
  if (!email.forwarded) return "";
  const name = partyName(email.forwarder);
  return name ? `${name} forwarded it. ` : "";
}

function heardSentence(proposals: EmailProposal[]): string {
  const asks = proposals.map(plainAsk);
  const first = asks[0] ?? "get this done";
  const second = asks[1];
  if (!second) return `It sounds like you want to ${first}.`;
  const rest = asks.slice(2);
  const extra = rest.length === 0
    ? ""
    : ` There's also ${rest.join(" and ")}.`;
  return `It sounds like you want to ${first}, and then ${second}.${extra}`;
}

function plainAsk(proposal: EmailProposal): string {
  const blob = `${proposal.title} ${proposal.summary ?? ""}`;
  if (/membership/i.test(blob) && /form|page/i.test(blob)) {
    const where = /lake tahoe/i.test(blob) ? "the Lake Tahoe membership page" : "the membership page";
    return `refresh ${where} with a better interest form`;
  }
  if (/questionnaire|500\+/i.test(blob)) {
    return "use the same questions to fill in the profiles on your 500+ person list";
  }
  if (/merge|clean/i.test(blob)) return "a cleanup of the interest contacts";
  if (/plan/i.test(blob)) return "a plan for the project updates";
  const sentence = (proposal.summary ?? proposal.title).split(/(?<=[.!?])\s/)[0] ?? proposal.title;
  return sentence.replace(/[.!?]$/, "").replace(/^(?:i'd like to |i want to |please )/i, "");
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
    const title = email.proposals[email.activeIndex ?? 0]?.title ?? "the next request";
    lines.push(`I'll start with ${title} (${n} of ${email.proposals.length}).`);
  }
  if (intro) lines.push(briefIntro(state));
  return lines.join("\n\n");
}

function briefIntro(state: ConversationState): string {
  const email = state.emailIntake;
  if (!email) return "";
  if (email.mode === "split" && email.proposals.length > 1) return "";
  const heard = heardSentence(email.proposals);
  return `${greeting(state)} Thanks for sending this over. ${forwardNote(email)}${heard} If you don't have an answer, say skip or not sure. Say back to change the last one.`;
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

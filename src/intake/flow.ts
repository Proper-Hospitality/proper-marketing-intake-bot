import {
  canonicalizeProperty,
  canonicalizeRequestType,
  canonicalizeTaskType,
  normalizeDate,
  taskTypeNames,
} from "./catalog.js";
import { isPricePendingStatement, listMissing, mentionsActualPrice, type MissingReport } from "./missing.js";
import { matchTemplates, type TemplateMatchResult } from "./templates.js";
import type { BriefDraft, RequestType } from "./types.js";

export interface RecordInput {
  requesterName?: string;
  requesterEmail?: string;
  requestName?: string;
  properties?: string[];
  requestedCompletionDate?: string;
  consequenceOfDelay?: string;
  requestType?: string;
  taskType?: string;
  followUps?: Record<string, string>;
  approver?: string;
  whereItGoesLive?: string;
  finalCopy?: string;
  copyOwner?: string;
  copyDueDate?: string;
  assets?: string[];
  assetsOwner?: string;
  assetsDue?: string;
  notes?: string;
  filingOnBehalf?: boolean;
  pricePending?: boolean;
}

export type FlowOutcome =
  | { kind: "need_property" }
  | { kind: "offer_template"; match: TemplateMatchResult }
  | { kind: "ask"; missing: MissingReport }
  | { kind: "confirm"; missing: MissingReport }
  | { kind: "accepted_template"; match: TemplateMatchResult }
  | { kind: "invalid"; errors: string[] };

export interface FlowState {
  draft: BriefDraft;
  phase: string;
  templateOffer: TemplateMatchResult | null;
  templateDeclinedReason?: string;
  templateDeclinedFor?: string;
  confirmVersion: number;
}

export function applyAnswers(state: FlowState, input: RecordInput, today = new Date()): FlowOutcome {
  const errors = mergeDraft(state.draft, input);
  if (errors.length > 0) return { kind: "invalid", errors };
  return advance(state, today);
}

export function declineTemplate(state: FlowState, reason: string, today = new Date()): FlowOutcome {
  const clean = reason.trim();
  if (!clean) return { kind: "invalid", errors: ["A reason is required when a template isn't used."] };
  state.templateDeclinedReason = clean;
  state.draft.templateUnusedReason = clean;
  if (state.draft.requestType && state.draft.taskType) {
    state.templateDeclinedFor = declineKey(state.draft);
  }
  state.phase = "collecting";
  return advance(state, today);
}

export function acceptTemplate(state: FlowState): FlowOutcome {
  if (!state.templateOffer || state.templateOffer.matches.length === 0) {
    return { kind: "invalid", errors: ["No template has been offered yet."] };
  }
  state.phase = "template_accepted";
  return { kind: "accepted_template", match: state.templateOffer };
}

function advance(state: FlowState, today: Date): FlowOutcome {
  const draft = state.draft;
  if (draft.requestType && draft.taskType) {
    const key = declineKey(draft);
    if (state.templateDeclinedFor && state.templateDeclinedFor !== key) {
      state.templateDeclinedReason = undefined;
      state.templateDeclinedFor = undefined;
      delete draft.templateUnusedReason;
    }
    if (!state.templateDeclinedReason) {
      const match = matchTemplates({
        requestType: draft.requestType,
        taskType: draft.taskType,
        properties: draft.properties ?? [],
        text: matchText(draft),
      });
      if (match.needsProperty) {
        state.phase = "collecting";
        return { kind: "need_property" };
      }
      if (match.matches.length > 0) {
        state.templateOffer = match;
        state.phase = "template_offered";
        return { kind: "offer_template", match };
      }
      state.templateOffer = null;
    }
  }

  const missing = listMissing(draft, today);
  if (missing.items.length > 0) {
    state.phase = "collecting";
    return { kind: "ask", missing };
  }
  state.phase = "awaiting_confirm";
  state.confirmVersion += 1;
  return { kind: "confirm", missing };
}

function mergeDraft(draft: BriefDraft, input: RecordInput): string[] {
  const errors: string[] = [];
  assignText(draft, "requesterName", input.requesterName);
  assignText(draft, "requesterEmail", input.requesterEmail);
  assignText(draft, "requestName", input.requestName);
  assignText(draft, "consequenceOfDelay", input.consequenceOfDelay);
  assignText(draft, "approver", input.approver);
  assignText(draft, "whereItGoesLive", input.whereItGoesLive);
  assignText(draft, "finalCopy", input.finalCopy);
  assignText(draft, "copyOwner", input.copyOwner);
  assignText(draft, "copyDueDate", input.copyDueDate);
  assignText(draft, "assetsOwner", input.assetsOwner);
  assignText(draft, "assetsDue", input.assetsDue);
  assignText(draft, "notes", input.notes);
  if (input.filingOnBehalf !== undefined) draft.filingOnBehalf = input.filingOnBehalf;
  if (input.pricePending === true) draft.pricePending = true;
  if (input.pricePending === false) draft.pricePending = false;

  if (input.requestedCompletionDate) {
    const date = normalizeDate(input.requestedCompletionDate);
    if (!date) errors.push(`Requested completion date "${input.requestedCompletionDate}" is not a real date. Use YYYY-MM-DD.`);
    else draft.requestedCompletionDate = date;
  }

  if (input.properties && input.properties.length > 0) {
    const resolved: string[] = [];
    const unknown: string[] = [];
    for (const property of input.properties) {
      const code = canonicalizeProperty(property);
      if (!code) unknown.push(property);
      else if (!resolved.includes(code)) resolved.push(code);
    }
    if (unknown.length > 0) {
      errors.push(`Unknown property: ${unknown.join(", ")}.`);
    } else {
      draft.properties = resolved;
    }
  }

  if (input.assets && input.assets.length > 0) {
    draft.assets = input.assets.map((asset) => asset.trim()).filter(Boolean);
  }

  let requestType: RequestType | undefined = draft.requestType;
  if (input.requestType) {
    const resolved = canonicalizeRequestType(input.requestType);
    if (!resolved) errors.push(`Unknown request type "${input.requestType}". Use Creative, Web, CRM & Paid, Social, or Marketing.`);
    else {
      if (draft.requestType && draft.requestType !== resolved) draft.taskType = undefined;
      draft.requestType = resolved;
      requestType = resolved;
    }
  }

  if (input.taskType) {
    if (!requestType) errors.push("Set the request type before the task type.");
    else {
      const resolved = canonicalizeTaskType(requestType, input.taskType);
      if (!resolved) {
        errors.push(
          `Unknown task type "${input.taskType}" for ${requestType}. Options: ${taskTypeNames(requestType).join(", ")}.`,
        );
      } else {
        draft.taskType = resolved;
      }
    }
  }

  if (input.followUps && requestType && draft.taskType) {
    draft.followUps = { ...(draft.followUps ?? {}) };
    for (const [label, value] of Object.entries(input.followUps)) {
      if (!value || !value.trim()) continue;
      const dateLike = /date/i.test(label);
      const trimmed = value.trim();
      if (dateLike) {
        const parsed = normalizeDate(trimmed);
        draft.followUps[label] = parsed ?? trimmed;
      } else {
        draft.followUps[label] = trimmed;
      }
      if (isPricePendingStatement(draft.followUps[label])) draft.pricePending = true;
      if (mentionsActualPrice(draft.followUps[label])) draft.pricePending = false;
    }
  } else if (input.followUps && Object.keys(input.followUps).length > 0 && !draft.taskType) {
    errors.push("Follow-up answers need a request type and task type first.");
  }

  return errors;
}

function assignText(draft: BriefDraft, key: keyof BriefDraft, value: string | undefined): void {
  if (!value || !value.trim()) return;
  (draft as Record<string, unknown>)[key] = value.trim();
}

function matchText(draft: BriefDraft): string {
  return [
    draft.requestName ?? "",
    draft.notes ?? "",
    draft.taskType ?? "",
    ...Object.values(draft.followUps ?? {}),
  ].join(" ");
}

function declineKey(draft: BriefDraft): string {
  return `${draft.requestType}|${draft.taskType}`;
}

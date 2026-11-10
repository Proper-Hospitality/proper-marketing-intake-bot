import {
  canonicalizeProperty,
  canonicalizeRequestType,
  canonicalizeTaskType,
  normalizeDate,
  taskTypeNames,
} from "./catalog.js";
import { dropSkipsThatWereAnswered } from "./conversation.js";
import { isPricePendingStatement, listMissing, mentionsActualPrice, type MissingReport } from "./missing.js";
import { formatCollateralOffer } from "./collateral/format.js";
import { matchCollateral, yearInText } from "./collateral/match.js";
import { catalogWithoutUpdatingProperties, unmatchedSourceNote } from "./collateral/sources.js";
import type { CollateralOffer } from "./collateral/types.js";
import { matchTemplates, type TemplateMatchResult } from "./templates.js";
import { planRoute } from "./routing.js";
import { classifyRush } from "./rush.js";
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
  | { kind: "ask_collateral_year" }
  | { kind: "ask_deliverable" }
  | { kind: "rush_required"; reason: "same_day" | "next_day" | "friday_monday" | "weekend"; date: string }
  | { kind: "offer_collateral"; offer: CollateralOffer }
  | { kind: "accepted_collateral"; offer: CollateralOffer }
  | { kind: "ask"; missing: MissingReport; preface?: string }
  | { kind: "confirm"; missing: MissingReport; preface?: string }
  | { kind: "accepted_template"; match: TemplateMatchResult }
  | { kind: "invalid"; errors: string[] };

export interface FlowState {
  draft: BriefDraft;
  phase: string;
  templateOffer: TemplateMatchResult | null;
  templateDeclinedReason?: string;
  templateDeclinedFor?: string;
  collateralOffer?: CollateralOffer | null;
  collateralDeclinedFor?: string;
  collateralOfferedFor?: string;
  collateralSourceFor?: string;
  rushExplainedFor?: string;
  confirmVersion: number;
}

export function applyAnswers(state: FlowState, input: RecordInput, today = new Date()): FlowOutcome {
  const errors = mergeDraft(state.draft, input, today);
  if (errors.length > 0) return { kind: "invalid", errors };
  dropSkipsThatWereAnswered(state.draft);
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

export function acceptCollateral(state: FlowState): FlowOutcome {
  if (!state.collateralOffer) return { kind: "invalid", errors: ["No existing collateral has been offered yet."] };
  state.phase = "collateral_accepted";
  return { kind: "accepted_collateral", offer: state.collateralOffer };
}

export function declineCollateral(state: FlowState, reason: string, today = new Date()): FlowOutcome {
  const year = yearInText(reason);
  if (year && !state.draft.collateralYear) state.draft.collateralYear = year;
  state.collateralDeclinedFor = collateralKey(state.draft);
  state.phase = "collecting";
  return advance(state, today);
}

function advance(state: FlowState, today: Date): FlowOutcome {
  const draft = state.draft;
  const routed = routeDeliverable(state);
  if (routed) return routed;

  if (
    draft.requestedCompletionDate
    && draft.rushBlock
    && draft.rushApprovedFor !== draft.requestedCompletionDate
    && state.rushExplainedFor !== draft.requestedCompletionDate
  ) {
    state.rushExplainedFor = draft.requestedCompletionDate;
    state.phase = "collecting";
    return { kind: "rush_required", reason: draft.rushBlock, date: draft.requestedCompletionDate };
  }

  const preface = sourcePreface(state);
  const missing = listMissing(draft, today);
  if (missing.items.length > 0) {
    state.phase = "collecting";
    return preface ? { kind: "ask", missing, preface } : { kind: "ask", missing };
  }
  state.phase = "awaiting_confirm";
  state.confirmVersion += 1;
  return preface ? { kind: "confirm", missing, preface } : { kind: "confirm", missing };
}

function mergeDraft(draft: BriefDraft, input: RecordInput, today: Date): string[] {
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
    else {
      draft.requestedCompletionDate = date;
      const rush = classifyRush(date, today);
      if (rush && draft.rushApprovedFor !== date) draft.rushBlock = rush;
      else delete draft.rushBlock;
    }
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

function collateralKey(draft: BriefDraft): string {
  return `${(draft.properties ?? []).join(",")}|${draft.taskType ?? ""}`;
}

const COLLATERAL_TASKS = new Set(["Sales Collateral", "Menu (F&B, Spa)", "Presentation / Deck"]);

function routeDeliverable(state: FlowState): FlowOutcome | undefined {
  const draft = state.draft;
  if (!draft.requestType || !draft.taskType) return undefined;
  if (state.phase === "template_offered" || state.phase === "awaiting_design_materials" || state.phase === "design_ready") {
    return undefined;
  }
  const text = matchText(draft);
  const key = declineKey(draft);
  if (state.templateDeclinedFor && state.templateDeclinedFor !== key) {
    state.templateDeclinedReason = undefined;
    state.templateDeclinedFor = undefined;
    delete draft.templateUnusedReason;
  }
  const declined = Boolean(state.templateDeclinedReason && state.templateDeclinedFor === key);
  const template = declined
    ? { matches: [], needsProperty: false, duplicateName: false }
    : matchTemplates({
      requestType: draft.requestType,
      taskType: draft.taskType,
      properties: draft.properties ?? [],
      text,
    });
  if (template.needsProperty && !draft.deliverableIntent) {
    state.phase = "collecting";
    return { kind: "need_property" };
  }
  const hasTemplate = template.matches.length > 0;
  const collateral = matchCollateral({
    properties: draft.properties ?? [],
    taskType: draft.taskType,
    text,
    requestedYear: draft.collateralYear ?? yearInText(text),
    yearUnspecified: draft.collateralYearUnspecified,
  }, catalogWithoutUpdatingProperties(draft.properties ?? []));
  const hasCollateral = Boolean(collateral.offer || collateral.needsYear);
  const plan = planRoute({
    chosen: draft.deliverableIntent,
    text,
    hasTemplate,
    hasCollateral,
  });
  if (plan === "ask") {
    state.phase = "collecting";
    return { kind: "ask_deliverable" };
  }
  if (plan === "existing") {
    const offered = considerCollateral(state);
    if (offered) return offered;
    return undefined;
  }
  if (plan === "modification" && hasTemplate) {
    state.templateOffer = template;
    state.phase = "template_offered";
    return { kind: "offer_template", match: template };
  }
  return undefined;
}

function considerCollateral(state: FlowState): FlowOutcome | undefined {
  const draft = state.draft;
  if (!draft.taskType || !COLLATERAL_TASKS.has(draft.taskType)) return undefined;
  if (!draft.properties || draft.properties.length === 0) return undefined;
  if (state.phase === "template_offered" || state.phase === "awaiting_design_materials" || state.phase === "design_ready") {
    return undefined;
  }
  const text = matchText(draft);
  const requestedYear = draft.collateralYear ?? yearInText(text);
  const result = matchCollateral({
    properties: draft.properties,
    taskType: draft.taskType,
    text,
    requestedYear,
    yearUnspecified: draft.collateralYearUnspecified,
  }, catalogWithoutUpdatingProperties(draft.properties));
  if (result.needsYear && !draft.collateralYear && !draft.collateralYearUnspecified) {
    state.phase = "collecting";
    return { kind: "ask_collateral_year" };
  }
  const key = collateralKey(draft);
  if (!result.offer) return undefined;
  if (state.collateralDeclinedFor === key) return undefined;
  if (state.collateralOfferedFor === key && state.phase !== "collateral_offered") return undefined;
  state.collateralOffer = result.offer;
  state.collateralOfferedFor = key;
  state.phase = "collateral_offered";
  return { kind: "offer_collateral", offer: result.offer };
}

function sourcePreface(state: FlowState): string | undefined {
  const draft = state.draft;
  if (!draft.taskType || !COLLATERAL_TASKS.has(draft.taskType)) return undefined;
  if (!draft.properties || draft.properties.length === 0) return undefined;
  const key = collateralKey(draft);
  if (state.collateralSourceFor === key) return undefined;
  const note = unmatchedSourceNote({
    properties: draft.properties,
    taskType: draft.taskType,
    text: matchText(draft),
    requestedYear: draft.collateralYear ?? yearInText(matchText(draft)),
    yearUnspecified: draft.collateralYearUnspecified,
  });
  if (!note) return undefined;
  state.collateralSourceFor = key;
  return note;
}

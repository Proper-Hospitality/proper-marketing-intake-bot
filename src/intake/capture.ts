import { FORM_URL } from "./catalog.js";
import { listMissing } from "./missing.js";
import {
  assignCompletionDate,
  extractDueDate,
  messageSuppliesDate,
  type ResolvedDate,
} from "./relative-date.js";
import type { BriefDraft } from "./types.js";
import type { ConversationState } from "../store/types.js";

export interface TurnAttachment {
  slackFileId: string;
  name?: string;
  permalink?: string;
  mimetype?: string;
}

export function noteResolvedDate(state: ConversationState, resolved: ResolvedDate | undefined): void {
  if (!resolved?.relative) {
    if (resolved && state.dateConfirmFor && state.dateConfirmFor !== resolved.iso) {
      state.dateConfirmFor = undefined;
      state.dateConfirmShown = false;
    }
    return;
  }
  if (state.dateConfirmFor !== resolved.iso) {
    state.dateConfirmFor = resolved.iso;
    state.dateConfirmShown = false;
  }
}

export function absorbTurnFacts(input: {
  state: ConversationState;
  userText: string;
  today: Date;
  expectingDate: boolean;
  attachments?: TurnAttachment[];
  specsByFileId?: Record<string, string>;
}): void {
  const { state, today } = input;
  const draft = state.draft;
  rememberLinks(draft, input.userText);
  const size = extractAssetSize(input.userText);
  if (size && !draft.followUps?.["Asset Size"]) {
    draft.followUps = { ...(draft.followUps ?? {}), "Asset Size": size };
  }
  const consequence = extractConsequence(input.userText);
  if (consequence && !draft.consequenceOfDelay) draft.consequenceOfDelay = consequence;

  rememberDesignFacts(draft, input.userText);
  const suppliesDate = messageSuppliesDate(input.userText);
  const maySetDate = !draft.requestedCompletionDate || (input.expectingDate && suppliesDate);
  const fromCurrent = maySetDate
    ? extractDueDate(input.userText, today, { expectingDate: input.expectingDate || suppliesDate })
    : undefined;
  if (fromCurrent && maySetDate) {
    assignCompletionDate(draft, fromCurrent.iso, today);
    noteResolvedDate(state, fromCurrent);
  } else if (!draft.requestedCompletionDate) {
    const prior = state.messages
      .filter((turn) => turn.role === "user")
      .map((turn) => turn.content)
      .join("\n");
    const fromPrior = extractDueDate(prior, today, { expectingDate: false });
    if (fromPrior) {
      assignCompletionDate(draft, fromPrior.iso, today);
      noteResolvedDate(state, fromPrior);
    }
  }

  for (const file of input.attachments ?? []) {
    rememberAttachment(draft, file, input.specsByFileId?.[file.slackFileId]);
  }
}

export function rememberAttachment(draft: BriefDraft, file: TurnAttachment, specs?: string): void {
  const name = file.name?.trim() || "attachment";
  const list = draft.attachments ?? [];
  const existing = list.find((item) => item.slackFileId === file.slackFileId)
    ?? list.find((item) => file.permalink && (item.ref === file.permalink || item.permalink === file.permalink))
    ?? list.find((item) => name !== "attachment" && (item.ref === name || item.name === name));
  if (existing) {
    if (!existing.slackFileId) existing.slackFileId = file.slackFileId;
    if (file.permalink && !existing.permalink) existing.permalink = file.permalink;
    if (file.mimetype && !existing.mimetype) existing.mimetype = file.mimetype;
    if (!existing.name || existing.name === "attachment") existing.name = name;
    if (!existing.ref) existing.ref = file.permalink || name;
    if (specs && !existing.specs) existing.specs = specs.slice(0, 1500);
  } else {
    list.push({
      ref: file.permalink || name,
      slackFileId: file.slackFileId,
      name,
      permalink: file.permalink,
      mimetype: file.mimetype,
      specs: specs?.slice(0, 1500),
    });
    draft.attachments = list;
  }
  const label = file.permalink || `Slack file ${name} (${file.slackFileId})`;
  const assets = draft.assets ?? [];
  if (!assets.some((asset) => asset.includes(file.slackFileId) || asset === label || asset.includes(name))) {
    draft.assets = [...assets, label];
  }
  if (specs && !draft.followUps?.["Asset Size"] && specsLookLikeSize(specs)) {
    draft.followUps = { ...(draft.followUps ?? {}), "Asset Size": specs.trim().slice(0, 500) };
  }
}

export function extractConsequence(text: string): string | undefined {
  const sentence = text.trim().split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  if (!sentence || sentence.length > 400) return undefined;
  if (/^(this |next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|eow)[.!]?$/i.test(sentence)) {
    return undefined;
  }
  if (/\b(create|design)\b/i.test(sentence) && sentence.length > 180) return undefined;
  if (!/\b(miss(?:es|ed| out)?|lose|lost|too late|won'?t make|will not make|opportunity)\b/i.test(sentence)) {
    return undefined;
  }
  if (!/\b(if|miss|lose|lost|late|opportunity|won'?t|will not)\b/i.test(sentence)) return undefined;
  return sentence.trim();
}

export function extractAssetSize(text: string): string | undefined {
  const labeled = text.match(/\bassets?\s*specs?\s*[:\-]\s*([^\n]+)/i);
  if (!labeled?.[1]) return undefined;
  return labeled[1].trim().replace(/[.]+$/, "");
}

export function specsLookLikeSize(text: string): boolean {
  return /\d+\s*[:x×]\s*\d+|vertical|horizontal|dimension|ratio|inch|screen|\d+\s*["″]/i.test(text);
}

export function contradictsCaptured(text: string, state: ConversationState, today: Date): boolean {
  const body = text.trim();
  if (!body) return false;
  const draft = state.draft;
  const missing = new Set(listMissing(draft, today).items.map((item) => item.id));
  const dateFilled = Boolean(draft.requestedCompletionDate) && !missing.has("requestedCompletionDate") && !missing.has("timing");
  if (draft.requestedCompletionDate && /isn'?t a calendar date|not a calendar date|can'?t safely work out|cannot safely work out|which friday|exact date/i.test(body)) {
    return true;
  }
  if (dateFilled && /when do you need this|requested completion date/i.test(body)) return true;
  const whyFilled = Boolean(draft.consequenceOfDelay) && !missing.has("consequenceOfDelay") && !missing.has("timing");
  if (whyFilled && /what happens if it'?s late|consequence of delay/i.test(body)) return true;
  if ((draft.attachments?.length ?? 0) > 0 && /can'?t open attachments|cannot open attachments|never saw|unable to (see|open) (the )?(file|attachment|image)/i.test(body)) {
    return true;
  }
  return false;
}

/** Homepage spot, the words it should say, and files they already linked. */
export function rememberDesignFacts(draft: BriefDraft, text: string): void {
  const placement = inferPlacement(text);
  if (placement) {
    const audience = draft.followUps?.["Audience / Distribution Plan"];
    if (!audience) {
      draft.followUps = { ...(draft.followUps ?? {}), "Audience / Distribution Plan": placement };
    }
    if (!draft.whereItGoesLive) draft.whereItGoesLive = placement;
  }
  const said = text.match(/\bshould say\s+["“']?([^"”'\n.]+)["”']?/i);
  const copy = said?.[1]?.trim();
  if (copy && !draft.followUps?.["Recommended Copy / Details"] && !draft.finalCopy) {
    draft.followUps = { ...(draft.followUps ?? {}), "Recommended Copy / Details": copy };
    draft.finalCopy = copy;
  }
  const files = extractLinks(text).filter((link) => /drive\.google|dropbox|brandfolder|box\.com/i.test(link));
  if (files.length > 0) {
    const assets = [...(draft.assets ?? [])];
    for (const link of files) {
      if (!assets.includes(link)) assets.push(link);
    }
    draft.assets = assets;
    if (!draft.followUps?.["Photo Link"]) {
      draft.followUps = { ...(draft.followUps ?? {}), "Photo Link": files[0] };
    }
  }
}

export function inferPlacement(text: string): string | undefined {
  if (!/\bhomepage\b/i.test(text)) return undefined;
  const spot = text.match(/\b(first|second|third|\d(?:st|nd|rd|th))\s+homepage\s+spot\b/i);
  if (spot?.[1]) return `the homepage, ${spot[1].toLowerCase()} spot`;
  if (/\bspot\b/i.test(text)) return "the homepage";
  return "the homepage";
}

function rememberLinks(draft: BriefDraft, text: string): void {
  const links = extractLinks(text);
  if (links.length === 0) return;
  const merged = [...(draft.providedLinks ?? [])];
  for (const link of links) {
    if (!merged.includes(link)) merged.push(link);
  }
  draft.providedLinks = merged;
  if (!draft.whereItGoesLive && /submit(?:ted)? via|officially submitted|link here/i.test(text)) {
    draft.whereItGoesLive = links[0];
  }
}

export function extractLinks(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>)\]]+/g) ?? [];
  const links: string[] = [];
  for (const match of matches) {
    const link = match.replace(/[.,;]+$/, "");
    if (link === FORM_URL || links.includes(link)) continue;
    links.push(link);
  }
  return links;
}

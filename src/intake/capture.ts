import { isFigmaLink } from "./attachments.js";
import { FORM_URL, inferProperties } from "./catalog.js";
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
  rememberRequestFacts(draft, input.userText);
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

export function rememberRequestFacts(draft: BriefDraft, text: string): void {
  if (!draft.properties?.length) {
    const properties = inferProperties(text);
    if (properties.length > 0) draft.properties = properties;
  }
  if (!draft.requestType || !draft.taskType) inferWebTask(draft, text);
  if (draft.requestType === "Web" && (draft.taskType === "Page Edit" || draft.taskType === "New Page")) {
    const link = extractLinks(text).find((item) => !isFigmaLink(item));
    if (link && !draft.followUps?.URL) {
      draft.followUps = { ...(draft.followUps ?? {}), URL: link };
      if (!draft.whereItGoesLive) draft.whereItGoesLive = link;
    }
  }
  if (draft.copyReady === undefined) {
    if (/\bcopy (is not|isn't) ready\b|\bno copy yet\b|\bstill writing the copy\b/i.test(text)) draft.copyReady = false;
    else if (/\bcopy is ready\b|\bhere's the copy\b|\bhere is the copy\b/i.test(text)) draft.copyReady = true;
  }
  if (draft.copyReady === false) {
    const writer = text.match(/\b([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)?)\s+is writing\b/);
    if (writer?.[1] && !draft.copyOwner) draft.copyOwner = writer[1];
  }
  if (draft.designNeeded === undefined) {
    if (/\b(no design|existing layout|copy only|just the copy|just copy)\b/i.test(text)) draft.designNeeded = false;
    else if (/\b(need design|needs design|design is needed)\b/i.test(text)) draft.designNeeded = true;
  }
  const replaces = text.match(/\breplaces?\s+([^.\n]+)/i);
  const spot = text.match(/\b(\d(?:st|nd|rd|th)|first|second|third)\s+(?:homepage\s+)?spot\b/i);
  const placement = [replaces?.[1]?.trim(), spot ? `${spot[1]} spot` : undefined].filter(Boolean).join(". ");
  if (placement && !draft.followUps?.["What it replaces and where it sits"]) {
    draft.followUps = { ...(draft.followUps ?? {}), "What it replaces and where it sits": placement };
  }
  const notify = text.match(/\b(?:also notify|loop in|updates to)\s+([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+)?)/i);
  if (notify?.[1]) {
    const name = notify[1].replace(/[.,]+$/, "");
    const names = draft.alsoNotify ?? [];
    if (!names.includes(name)) draft.alsoNotify = [...names, name];
  }
  rememberOfferFacts(draft, text);
}

function inferWebTask(draft: BriefDraft, text: string): void {
  if (/\bnew page\b|\blanding page\b/i.test(text)) {
    draft.requestType = draft.requestType ?? "Web";
    draft.taskType = draft.taskType ?? "New Page";
    return;
  }
  if (/\bpage edit\b|\bedit the page\b|\bupdate the (page|homepage)\b/i.test(text)) {
    draft.requestType = draft.requestType ?? "Web";
    draft.taskType = draft.taskType ?? "Page Edit";
    return;
  }
  if (/\bhappening/i.test(text)) {
    draft.requestType = draft.requestType ?? "Web";
    draft.taskType = draft.taskType ?? "Happenings";
    return;
  }
  if (/\bmenu upload\b/i.test(text)) {
    draft.requestType = draft.requestType ?? "Web";
    draft.taskType = draft.taskType ?? "Menu Upload";
  }
}

function rememberOfferFacts(draft: BriefDraft, text: string): void {
  if (!/\boffer\b|promo code|rate code/i.test(text) && draft.taskType !== "Offers") return;
  const followUps = { ...(draft.followUps ?? {}) };
  const down = text.match(/[^.!\n]*(?:comes down|turned off|take down)[^.!\n]*/i)?.[0]?.trim();
  if (down && !followUps["When the old offer comes down"]) followUps["When the old offer comes down"] = down;
  const ads = text.match(/[^.!\n]*(?:evergreen|replaces? it in (?:the )?ads)[^.!\n]*/i)?.[0]?.trim();
  if (ads && !followUps["What replaces it in ads or evergreen campaigns"]) {
    followUps["What replaces it in ads or evergreen campaigns"] = ads;
  }
  if (/\btransactional emails?\b/i.test(text) && !followUps["Rate or promo codes in transactional emails"]) {
    followUps["Rate or promo codes in transactional emails"] = /\b(no|not|aren't|are not|unaffected)\b/i.test(text) ? "No" : "Yes";
  }
  if (/\brules (?:and|&) regulations\b/i.test(text) && /\bphoto\b/i.test(text) && !followUps["Offer copy, rules, and photo"]) {
    followUps["Offer copy, rules, and photo"] = "Copy, rules and regulations, and a photo are attached.";
  }
  draft.followUps = followUps;
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

import { propertyPhrase } from "./catalog.js";
import type { BriefDraft } from "./types.js";

/**
 * Asana task title. Change the pattern here if the team agrees on a different one.
 * {property} is the code or codes. {type} is the task type. {name} is the short title.
 */
export const TASK_NAME_PATTERN = "{property} | {type} | {name}";

const SMALL_WORDS = new Set(["a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at"]);

export function taskName(draft: BriefDraft): string {
  const property = (draft.properties ?? []).filter(Boolean).join(", ") || "Property";
  const type = draft.taskType || draft.requestType || "Request";
  const name = shortTaskName(draft.requestName, draft);
  return TASK_NAME_PATTERN
    .replaceAll("{property}", property)
    .replaceAll("{type}", type)
    .replaceAll("{name}", name);
}

export function shortTaskName(raw: string | undefined, draft: BriefDraft): string {
  let text = (raw ?? "").replace(/\s+/g, " ").trim();
  const phrases = stripPhrases(draft).sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    text = text.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "ig"), " ");
  }
  text = text.replace(/[|]+/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(/^(?:for|the|a|an|to|of|and|on|at)\b\s*/i, "").trim();
  const words = text.split(/\s+/).filter(Boolean).slice(0, 6);
  if (words.length === 0) return "Request";
  return titleCase(words);
}

function stripPhrases(draft: BriefDraft): string[] {
  const phrases = new Set<string>();
  for (const code of draft.properties ?? []) {
    phrases.add(code);
    const named = propertyPhrase(code).replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (named && named.toLowerCase() !== code.toLowerCase()) phrases.add(named);
  }
  if (draft.taskType) phrases.add(draft.taskType);
  if (draft.requestType) phrases.add(draft.requestType);
  return [...phrases].filter((phrase) => phrase.length > 1);
}

function titleCase(words: string[]): string {
  return words.map((word, index) => {
    if (/^[A-Z0-9]{2,}$/.test(word)) return word;
    const lower = word.toLowerCase();
    if (index > 0 && SMALL_WORDS.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

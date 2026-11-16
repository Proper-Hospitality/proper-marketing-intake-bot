import type { BriefDraft } from "./types.js";

/**
 * Asana task title. The intake board used "{property} | {type} | {name}".
 * Kinsey's form uses "{property}, {name}", with the request name as given.
 */
export const TASK_NAME_PATTERN = "{property}, {name}";

export function taskName(draft: BriefDraft): string {
  const property = (draft.properties ?? []).filter(Boolean).join(", ") || "Property";
  const name = (draft.requestName ?? "").replace(/\s+/g, " ").trim() || "Request";
  return TASK_NAME_PATTERN
    .replaceAll("{property}", property)
    .replaceAll("{name}", name);
}

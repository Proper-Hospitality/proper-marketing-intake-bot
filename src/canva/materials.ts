import type { DesignBuild, DesignCandidate, DesignPhoto } from "../store/types.js";

const NOT_READY = /\b(don'?t|do not|dont) have\b|\bnot yet\b|\bcome back\b|\bcan'?t find\b|\bno (photos|photo|copy|images|pics)\b|\bcheck with\b|\bmarketing manager\b|\bi('ll| will) (find|get|send|grab)\b/i;
const DECLINE = /doesn'?t (fit|work)|don'?t like|do not like|team (should |to )?design|design it|not the right template|skip the template|full (brief|submission)|rather the team/i;
const EDIT = /\b(edit|change|update|tweak|revise|instead|replace|swap|fix the|new version)\b/i;
const NOT_COPY = /^(here('s| is)?( the)?( photos?| images?| pics)?|photos? attached|attached|see attached|uploaded)[.!]?$/i;

export function chooseCandidate(text: string, candidates: DesignCandidate[]): DesignCandidate | undefined {
  const haystack = text.toLowerCase();
  return candidates.find((candidate) => haystack.includes(candidate.id.toLowerCase()) || haystack.includes(candidate.name.toLowerCase()));
}

export function photoUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s>]+/gi) ?? [];
  return matches
    .map((url) => url.replace(/[)\].,]+$/, ""))
    .filter((url) => !url.includes("canva.com/brand/brand-templates"));
}

export function extractCopy(text: string): string | undefined {
  return stripDesignCopy(text);
}

/** Drops Slack lead-ins so only the words for the design remain. */
export function stripDesignCopy(text: string): string | undefined {
  let cleaned = text.replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  const labeled = cleaned.match(/(?:^|\s)(?:copy|text)\s*:\s*(.+)$/i);
  if (labeled?.[1]) cleaned = labeled[1].trim();
  cleaned = cleaned.replace(/^here(?:'s| is)\s+the\s+copy(?:\s+and\s+the\s+photos?)?\s*[:,-]?\s*/i, "");
  cleaned = cleaned.replace(/^(?:and\s+)?(?:here(?:'s| is)\s+)?(?:the\s+)?photos?(?:\s+(?:is|are))?(?:\s+attached)?\s*[:,-]?\s*/i, "");
  cleaned = cleaned.replace(/^\d+\s*[.)-]\s*/, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length < 8 || NOT_COPY.test(cleaned) || DECLINE.test(cleaned)) return undefined;
  if (NOT_READY.test(cleaned)) return undefined;
  return cleaned;
}

export function mergeMaterials(
  design: DesignBuild,
  text: string,
  uploads: DesignPhoto[],
  cleanedCopy?: string,
): DesignBuild {
  const next: DesignBuild = {
    ...design,
    photos: [...design.photos],
  };
  const copy = cleanedCopy?.trim() || extractCopy(text);
  if (copy) {
    next.copy = design.version > 0 && design.copy && EDIT.test(text) && !/^\s*(?:copy|text)\s*:/i.test(text)
      ? `${design.copy}\n\nUpdate: ${copy}`
      : copy;
  }
  const seen = new Set(next.photos.map((photo) => photo.slackFileId || photo.url));
  for (const photo of uploads) {
    const key = photo.slackFileId || photo.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.photos.push(photo);
  }
  for (const url of photoUrls(text)) {
    if (seen.has(url)) continue;
    seen.add(url);
    next.photos.push({ source: "url", url, name: fileNameFromUrl(url) });
  }
  if (!next.templateId) {
    const chosen = chooseCandidate(text, next.candidates);
    if (chosen) next.templateId = chosen.id;
    else if (next.candidates.length === 1) next.templateId = next.candidates[0].id;
  }
  return next;
}

export function materialsIntent(
  text: string,
  design: DesignBuild,
  uploads: DesignPhoto[] = [],
): "decline" | "not_ready" | "edit" | "provide" {
  if (DECLINE.test(text)) return "decline";
  if (design.version > 0 && (EDIT.test(text) || extractCopy(text) || photoUrls(text).length > 0 || uploads.length > 0)) return "edit";
  if (NOT_READY.test(text)) return "not_ready";
  return "provide";
}

export function missingPieces(design: DesignBuild): string[] {
  const missing: string[] = [];
  if (!design.templateId) missing.push("which template to use");
  if (!design.copy) missing.push("the final copy");
  if (design.photos.length === 0) missing.push("the photos");
  return missing;
}

function fileNameFromUrl(url: string): string {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name).slice(0, 50) : "photo";
  } catch {
    return "photo";
  }
}

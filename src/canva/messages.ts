import type { DesignBuild } from "../store/types.js";
import { missingPieces } from "./materials.js";

export function formatBuildOffer(design: DesignBuild): string {
  const lines = ["I can build this in Canva."];
  if (design.candidates.length === 1) {
    const template = design.candidates[0];
    lines.push(`Template: *${template.name}* (${template.useFor}).`, template.url);
  } else {
    lines.push("More than one template fits. Tell me which one to build:");
    for (const template of design.candidates) lines.push(`• *${template.name}* (${template.useFor}): ${template.url}`);
  }
  lines.push(
    "",
    "Before I start, send both of these in this thread:",
    "1. The final copy, in the words that should appear on the design.",
    "2. The photos. Upload them here, or paste a link to each photo.",
    "",
    "If you don't have the copy or the photos yet, find them or check with your marketing manager, then reply in this same thread. I'll keep this request and pick it up when you come back.",
    "",
    "If this template doesn't work, or you want the team to design it, say so and I'll collect the full brief.",
  );
  return lines.join("\n");
}

export function formatMaterialsHold(design: DesignBuild): string {
  const missing = missingPieces(design);
  const saved = [
    design.copy ? "I saved the copy." : "",
    design.photos.length > 0 ? `I saved ${design.photos.length} photo${design.photos.length === 1 ? "" : "s"}.` : "",
  ].filter(Boolean).join(" ");
  return [
    saved,
    "I can't start the design until the final copy and the photos are in this thread.",
    missing.length > 0 ? `Still needed: ${missing.join(", ")}.` : "",
    "Find them, or check with your marketing manager, then reply here. I'll pick this up in the same thread.",
  ].filter(Boolean).join(" ");
}

export function formatMaterialsAsk(design: DesignBuild): string {
  const missing = missingPieces(design);
  return `I can build this once I have ${missing.join(" and ")}. Reply in this thread with what you have.`;
}

export function formatDesignReady(editUrl: string, viewUrl: string): string {
  return [
    "Here's the Canva design for review.",
    `Edit: ${editUrl}`,
    `View: ${viewUrl}`,
    "Reply in this thread if you want a change. I'll make a new design and send a fresh link.",
  ].join("\n");
}

export function formatFreshVersion(editUrl: string, viewUrl: string): string {
  return [
    "This is a fresh version: a new Canva design, not a change to the previous file.",
    `Edit: ${editUrl}`,
    `View: ${viewUrl}`,
    "Reply here if you want another version.",
  ].join("\n");
}

export function formatDesignFallback(design: DesignBuild, reason: string): string {
  const template = design.candidates.find((candidate) => candidate.id === design.templateId) ?? design.candidates[0];
  return [
    `I can't fill *${template?.name ?? "this template"}* automatically (${reason}).`,
    template ? `Template: ${template.url}` : "",
    "",
    "Copy to place on it:",
    design.copy || "(no copy yet)",
    "",
    "If you want the team to design it, say so and I'll collect the full brief.",
  ].filter((line) => line !== "").join("\n");
}

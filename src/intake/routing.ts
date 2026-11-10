export type DeliverableIntent = "existing" | "modification";
export type RoutePlan = "ask" | "existing" | "modification" | "brief";

const EXISTING = /\b(existing|already (have|exists|made)|send (me )?the (current |existing )?(file|one)|the file we have|use the (current|existing))\b/i;
const MODIFICATION = /\b(modif(?:y|ied|ication)|update|change|edit|revise|new version|tweak)\b/i;

export function inferDeliverableIntent(text: string): DeliverableIntent | "unclear" {
  const existing = EXISTING.test(text);
  const modification = MODIFICATION.test(text);
  if (existing && !modification) return "existing";
  if (modification && !existing) return "modification";
  return "unclear";
}

export function planRoute(input: {
  chosen?: DeliverableIntent;
  text: string;
  hasTemplate: boolean;
  hasCollateral: boolean;
}): RoutePlan {
  const intent = input.chosen ?? inferDeliverableIntent(input.text);
  if (!input.chosen && input.hasTemplate && input.hasCollateral && intent === "unclear") return "ask";
  if (intent === "existing") return input.hasCollateral ? "existing" : "brief";
  if (intent === "modification") return input.hasTemplate ? "modification" : "brief";
  if (input.hasCollateral && !input.hasTemplate) return "existing";
  if (input.hasTemplate && !input.hasCollateral) return "modification";
  return "brief";
}

export function parseDeliverableChoice(text: string): DeliverableIntent | undefined {
  const trimmed = text.trim();
  if (/^(existing|the existing file|the file|send the file|use the file)\b/i.test(trimmed)) return "existing";
  if (/^(modif|change|update|edit|a change|new version)/i.test(trimmed)) return "modification";
  return undefined;
}

export const DELIVERABLE_QUESTION = "Do you want the existing file, or a change to that file?";

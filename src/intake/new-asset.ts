import { canonicalizeProperty, inferProperties } from "./catalog.js";
import type { RequestType } from "./types.js";

export interface NewAssetStart {
  requestType: RequestType;
  taskType: string;
  novelty: "new";
  properties?: string[];
  requestName: string;
  notes: string;
}

const NEW_VERB = /\b(send|sending|create|creating|make|making|build|building)\b|\bnew\b/i;
const EDIT_VERB = /\b(edit|editing|update|updating|change|changing|fix|tweak|refresh|revise)\b/i;

/**
 * "Send an email", "create a post", "new menu", and the same verbs for other assets
 * are new requests. They are not an edit, and they are not a design-versus-send choice.
 */
export function classifyNewAsset(text: string): NewAssetStart | undefined {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 400) return undefined;
  if (EDIT_VERB.test(cleaned) || !NEW_VERB.test(cleaned)) return undefined;
  const kind = assetKind(cleaned);
  if (!kind) return undefined;
  const property = propertyIn(cleaned);
  return {
    ...kind,
    novelty: "new",
    properties: property ? [property] : undefined,
    notes: cleaned,
  };
}

export function parseEmailSplit(text: string): "design" | "send" | "both" | undefined {
  const plain = text.trim();
  if (!plain) return undefined;
  if (/\bboth\b/i.test(plain)) return "both";
  const design = /\bdesign/i.test(plain);
  const send = /\bsend/i.test(plain);
  if (design && send) return "both";
  if (design) return "design";
  if (send) return "send";
  return undefined;
}

function assetKind(text: string): Pick<NewAssetStart, "requestType" | "taskType" | "requestName"> | undefined {
  if (/\bemails?\b/i.test(text)) return { requestType: "Creative", taskType: "Email", requestName: "Email" };
  if (/\bsms\b/i.test(text)) return { requestType: "Creative", taskType: "SMS", requestName: "SMS" };
  if (/\bpop[\s-]?ups?\b/i.test(text)) return { requestType: "CRM & Paid", taskType: "Pop Up", requestName: "Popup" };
  if (/\bstor(y|ies)\b/i.test(text)) return { requestType: "Social", taskType: "Story Request", requestName: "Story" };
  if (/\b(feed\s*)?posts?\b|\binstagram\b|\bsocial\b/i.test(text)) {
    return { requestType: "Social", taskType: "Feed Post Request", requestName: "Social post" };
  }
  if (/\bmenus?\b/i.test(text)) return { requestType: "Creative", taskType: "Menu (F&B, Spa)", requestName: "Menu" };
  if (/\b(landing\s*)?pages?\b|\bwebsite\b/i.test(text)) return { requestType: "Web", taskType: "New Page", requestName: "New page" };
  if (/\bads?\b/i.test(text)) return { requestType: "Creative", taskType: "Ad", requestName: "Ad" };
  return undefined;
}

function propertyIn(text: string): string | undefined {
  const found = inferProperties(text);
  if (found[0]) return found[0];
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const code = canonicalizeProperty(word);
    if (code) return code;
  }
  return undefined;
}

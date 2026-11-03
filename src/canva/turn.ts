import type { TemplateMatchResult } from "../intake/templates.js";
import { declineTemplate } from "../intake/flow.js";
import type { ConversationState, DesignBuild, DesignPhoto, Store } from "../store/types.js";
import { buildAutofillDesign, type BuildResult } from "./build.js";
import type { FieldMapper } from "./map-fields.js";
import { missingPieces, materialsIntent, mergeMaterials } from "./materials.js";
import {
  formatBuildOffer,
  formatDesignFallback,
  formatDesignReady,
  formatFreshVersion,
  formatMaterialsAsk,
  formatMaterialsHold,
} from "./messages.js";
import { canvaEnvConfigured, getCanvaAccessToken } from "./oauth.js";

export interface CanvaDesignClient {
  connected(): Promise<boolean>;
  build(input: {
    templateId: string;
    title: string;
    copy: string;
    photos: Array<{ name: string; bytes: Uint8Array }>;
  }): Promise<BuildResult>;
}

export interface DesignTurnInput {
  state: ConversationState;
  userText: string;
  uploads: DesignPhoto[];
  canva?: CanvaDesignClient;
  download?: (photo: DesignPhoto) => Promise<{ name: string; bytes: Uint8Array }>;
  today?: Date;
}

export type DesignTurnResult =
  | { action: "reply"; text: string }
  | { action: "decline"; reason: string }
  | { action: "pass" };

export function createCanvaDesignClient(args: {
  store: Store;
  llm: FieldMapper;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): CanvaDesignClient {
  return {
    async connected() {
      try {
        if (!canvaEnvConfigured()) return false;
        const token = await getCanvaAccessToken({ store: args.store, fetchImpl: args.fetchImpl });
        return Boolean(token);
      } catch (error) {
        console.error(JSON.stringify({
          msg: "canva_token_unavailable",
          error: error instanceof Error ? error.message : "unknown",
        }));
        return false;
      }
    },
    async build(input) {
      const token = await getCanvaAccessToken({ store: args.store, fetchImpl: args.fetchImpl }).catch((error: unknown) => {
        console.error(JSON.stringify({
          msg: "canva_token_unavailable",
          error: error instanceof Error ? error.message : "unknown",
        }));
        return null;
      });
      if (!token) return { kind: "fallback", reason: "Canva is not connected" };
      return buildAutofillDesign({
        token,
        templateId: input.templateId,
        title: input.title,
        copy: input.copy,
        photos: input.photos,
        llm: args.llm,
        fetchImpl: args.fetchImpl,
        sleep: args.sleep,
      });
    },
  };
}

export async function offerDesignBuild(state: ConversationState, match: TemplateMatchResult, canva: CanvaDesignClient): Promise<string | null> {
  if (match.matches.length === 0 || !(await canva.connected())) return null;
  state.design = {
    candidates: match.matches.map((item) => ({
      id: item.id,
      name: item.name,
      url: item.url,
      useFor: item.useFor,
    })),
    templateId: match.matches.length === 1 ? match.matches[0].id : undefined,
    copy: state.draft.finalCopy,
    photos: [],
    version: 0,
  };
  state.phase = "awaiting_design_materials";
  return formatBuildOffer(state.design);
}

export async function continueDesign(input: DesignTurnInput): Promise<DesignTurnResult> {
  const design = input.state.design;
  if (!design || !input.canva) return { action: "pass" };
  if (input.state.phase !== "awaiting_design_materials" && input.state.phase !== "design_ready") return { action: "pass" };

  const text = input.userText.replace(/\n?Files:.*$/s, "").trim();
  const intent = materialsIntent(text, design, input.uploads);
  if (intent === "decline") return { action: "decline", reason: text };

  const merged = mergeMaterials(design, text, input.uploads);
  input.state.design = merged;
  if (intent === "not_ready") return { action: "reply", text: formatMaterialsHold(merged) };
  if (input.state.phase === "design_ready" && intent !== "edit") return { action: "pass" };

  const missing = missingPieces(merged);
  if (missing.length > 0) return { action: "reply", text: formatMaterialsAsk(merged) };

  const built = await runBuild(input.state, input.canva, input.download);
  return { action: "reply", text: built };
}

export function declineDesign(state: ConversationState, reason: string, today = new Date()) {
  state.design = undefined;
  return declineTemplate(state, reason, today);
}

async function runBuild(
  state: ConversationState,
  canva: CanvaDesignClient,
  download?: (photo: DesignPhoto) => Promise<{ name: string; bytes: Uint8Array }>,
): Promise<string> {
  const design = state.design as DesignBuild;
  const template = design.candidates.find((candidate) => candidate.id === design.templateId) ?? design.candidates[0];
  let photos: Array<{ name: string; bytes: Uint8Array }> = [];
  try {
    if (!download) throw new Error("I can't download photos from this conversation.");
    photos = [];
    for (const photo of design.photos) photos.push(await download(photo));
  } catch (error) {
    return `I couldn't download a photo. ${error instanceof Error ? error.message : "Try uploading it again in this thread."}`;
  }
  const fresh = design.version > 0;
  const title = `${state.draft.requestName || template.name}${fresh ? ` v${design.version + 1}` : ""}`;
  const result = await canva.build({
    templateId: template.id,
    title,
    copy: design.copy ?? "",
    photos,
  });
  if (result.kind === "design") {
    design.version += 1;
    design.lastEditUrl = result.editUrl;
    design.lastViewUrl = result.viewUrl;
    state.phase = "design_ready";
    state.templateOffer = {
      matches: [{ id: template.id, name: template.name, useFor: template.useFor, url: template.url, score: 1 }],
      duplicateName: false,
      needsProperty: false,
    };
    const note = !result.photosPlaced && design.photos.length > 0
      ? "This template has no photo field, so the photos were not placed on the design."
      : "";
    const message = fresh
      ? formatFreshVersion(result.editUrl, result.viewUrl)
      : formatDesignReady(result.editUrl, result.viewUrl);
    return note ? `${message}\n${note}` : message;
  }
  state.phase = "template_offered";
  state.templateOffer = {
    matches: design.candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      useFor: candidate.useFor,
      url: candidate.url,
      score: 1,
    })),
    duplicateName: design.candidates.length > 1 && design.candidates.every((candidate) => candidate.name === design.candidates[0].name),
    needsProperty: false,
  };
  if (result.kind === "fallback") return formatDesignFallback(design, result.reason);
  return `${formatDesignFallback(design, "Canva returned an error")}\n\n${result.message}`;
}

import { autofillUnavailable, CanvaApiError, createAutofill, getBrandTemplateDataset, uploadAsset } from "./api.js";
import { mapCopyToTextFields, type FieldMapper } from "./map-fields.js";

export const NEEDS_TAGS_REASON =
  "this template has no autofill fields tagged. Tag the text and photo elements in the Canva editor: open the template, choose Apps, then Bulk Create, then Labels, and add a Data field on each element. The Connect API cannot add those tags";

export type BuildResult =
  | { kind: "design"; editUrl: string; viewUrl: string; photosPlaced: boolean }
  | { kind: "fallback"; reason: string }
  | { kind: "error"; message: string };

export async function buildAutofillDesign(args: {
  token: string;
  templateId: string;
  title: string;
  copy: string;
  photos: Array<{ name: string; bytes: Uint8Array }>;
  llm: FieldMapper;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Promise<BuildResult> {
  try {
    const dataset = await getBrandTemplateDataset({
      token: args.token,
      templateId: args.templateId,
      fetchImpl: args.fetchImpl,
    });
    const entries = Object.entries(dataset);
    if (entries.length === 0) {
      return { kind: "fallback", reason: NEEDS_TAGS_REASON };
    }
    const textFields = entries.filter(([, field]) => field.type === "text").map(([name]) => name);
    const imageFields = entries.filter(([, field]) => field.type === "image").map(([name]) => name);
    if (textFields.length === 0 && imageFields.length === 0) {
      return { kind: "fallback", reason: "this template has no text or photo autofill fields" };
    }
    const data: Record<string, { type: "text"; text: string } | { type: "image"; asset_id: string }> = {};
    if (textFields.length > 0) {
      const mapped = await mapCopyToTextFields({ llm: args.llm, fieldNames: textFields, copy: args.copy });
      for (const name of textFields) data[name] = { type: "text", text: mapped[name] ?? "" };
    }
    for (let index = 0; index < imageFields.length && index < args.photos.length; index += 1) {
      const photo = args.photos[index];
      const assetId = await uploadAsset({
        token: args.token,
        name: photo.name,
        bytes: photo.bytes,
        fetchImpl: args.fetchImpl,
        sleep: args.sleep,
      });
      data[imageFields[index]] = { type: "image", asset_id: assetId };
    }
    const design = await createAutofill({
      token: args.token,
      templateId: args.templateId,
      title: args.title,
      data,
      fetchImpl: args.fetchImpl,
      sleep: args.sleep,
    });
    return {
      kind: "design",
      editUrl: design.editUrl,
      viewUrl: design.viewUrl,
      photosPlaced: imageFields.length > 0 && args.photos.length > 0,
    };
  } catch (error) {
    if (autofillUnavailable(error)) {
      const reason = error instanceof CanvaApiError && /upgrad|plan|enterprise/i.test(error.message)
        ? "Canva autofill needs a plan that includes it (Canva Enterprise)"
        : "this template can't be filled automatically";
      return { kind: "fallback", reason };
    }
    const message = error instanceof Error ? error.message : "Canva could not build the design.";
    return { kind: "error", message };
  }
}

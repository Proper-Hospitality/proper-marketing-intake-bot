import { describe, expect, it, vi } from "vitest";
import { buildAutofillDesign } from "../src/canva/build.js";
import { parseFieldMap } from "../src/canva/map-fields.js";
import type { FieldMapper } from "../src/canva/map-fields.js";

describe("Canva autofill", () => {
  it("uploads a photo, maps copy onto text fields, and returns the new design links", async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url: href, method: init?.method ?? "GET", headers, body });
      if (href.endsWith("/dataset")) {
        return json({ dataset: { Headline: { type: "text" }, Photo: { type: "image" }, Chart: { type: "chart" } } });
      }
      if (href.endsWith("/asset-uploads")) {
        expect(headers["content-type"]).toBe("application/octet-stream");
        expect(headers["asset-upload-metadata"]).toContain("name_base64");
        return json({ job: { id: "job-asset", status: "in_progress" } });
      }
      if (href.endsWith("/asset-uploads/job-asset")) {
        return json({ job: { id: "job-asset", status: "success", asset: { id: "Msd59349ff" } } });
      }
      if (href.endsWith("/autofills") && (init?.method ?? "GET") === "POST") {
        return json({ job: { id: "job-fill", status: "in_progress" } });
      }
      if (href.endsWith("/autofills/job-fill")) {
        return json({
          job: {
            id: "job-fill",
            status: "success",
            result: { design: { urls: { edit_url: "https://www.canva.com/design/NEW/edit", view_url: "https://www.canva.com/design/NEW/view" } } },
          },
        });
      }
      return json({ message: "missing" }, 404);
    });
    const llm: FieldMapper = {
      async complete() {
        return { content: [{ type: "text", text: "{\"fields\":{\"Headline\":\"Join us Friday\"}}" }] };
      },
    };
    const result = await buildAutofillDesign({
      token: "access-token",
      templateId: "EAHJyAsHwPs",
      title: "Weekly happenings",
      copy: "Join us Friday",
      photos: [{ name: "roof.jpg", bytes: Uint8Array.from([1, 2, 3]) }],
      llm,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    expect(result).toEqual({
      kind: "design",
      editUrl: "https://www.canva.com/design/NEW/edit",
      viewUrl: "https://www.canva.com/design/NEW/view",
      photosPlaced: true,
    });
    const autofill = calls.find((call) => call.url.endsWith("/autofills") && call.method === "POST");
    const payload = JSON.parse(autofill?.body ?? "{}") as {
      type: string;
      brand_template_id: string;
      data: Record<string, { type: string; text?: string; asset_id?: string }>;
    };
    expect(payload.type).toBe("create_from_brand_template");
    expect(payload.brand_template_id).toBe("EAHJyAsHwPs");
    expect(payload.data.Headline).toEqual({ type: "text", text: "Join us Friday" });
    expect(payload.data.Photo).toEqual({ type: "image", asset_id: "Msd59349ff" });
    expect(payload.data.Chart).toBeUndefined();
    expect(calls.some((call) => call.url.includes("/brand-templates/EAHJyAsHwPs/dataset"))).toBe(true);
  });

  it("falls back when the template has no dataset or autofill is not on the plan", async () => {
    const empty = await buildAutofillDesign({
      token: "access-token",
      templateId: "EAHJyAsHwPs",
      title: "Weekly happenings",
      copy: "Join us Friday",
      photos: [],
      llm: { async complete() { return { content: [] }; } },
      fetchImpl: vi.fn(async () => json({ dataset: {} })) as unknown as typeof fetch,
      sleep: async () => {},
    });
    expect(empty.kind).toBe("fallback");
    if (empty.kind === "fallback") {
      expect(empty.reason).toMatch(/no autofill fields tagged/);
      expect(empty.reason).toMatch(/Connect API cannot add those tags/);
    }

    const blocked = await buildAutofillDesign({
      token: "access-token",
      templateId: "EAHJyAsHwPs",
      title: "Weekly happenings",
      copy: "Join us Friday",
      photos: [],
      llm: { async complete() { return { content: [] }; } },
      fetchImpl: vi.fn(async () => json({
        code: "permission_denied",
        message: "Access the autofill feature and other powerful design tools by upgrading your Canva plan here: https://www.canva.com/pro/",
      }, 403)) as unknown as typeof fetch,
      sleep: async () => {},
    });
    expect(blocked.kind).toBe("fallback");
    if (blocked.kind === "fallback") expect(blocked.reason).toMatch(/Enterprise/);

    const unfillable = await buildAutofillDesign({
      token: "access-token",
      templateId: "EAHJyAsHwPs",
      title: "Weekly happenings",
      copy: "Join us Friday",
      photos: [],
      llm: { async complete() { return { content: [] }; } },
      fetchImpl: vi.fn(async () => json({
        code: "design_not_fillable",
        message: "Design does not have any autofill capable elements",
      }, 400)) as unknown as typeof fetch,
      sleep: async () => {},
    });
    expect(unfillable).toEqual({ kind: "fallback", reason: "this template can't be filled automatically" });
  });

  it("keeps only dataset field names from Claude's JSON", () => {
    expect(parseFieldMap("Sure. {\"fields\":{\"Headline\":\"Friday\",\"Extra\":\"no\"}}", ["Headline"])).toEqual({
      Headline: "Friday",
    });
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

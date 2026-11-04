import { describe, expect, it } from "vitest";
import { NEEDS_TAGS_REASON } from "../src/canva/build.js";
import { classifyDataset, formatDatasetReport, liveTemplates } from "../src/canva/dataset-report.js";
import { extractDesignCopy } from "../src/canva/extract-copy.js";
import { stripDesignCopy } from "../src/canva/materials.js";
import { formatDesignFallback } from "../src/canva/messages.js";
import { runIntakeTurn, type Llm } from "../src/agent/run.js";
import { emptyConversation } from "../src/store/types.js";

const ELENA = "here's the copy and the photo: 1. SMP winter entertainment promo. up to 20% off";

describe("design copy extraction", () => {
  it("strips the Slack lead-in down to the words for the design", () => {
    expect(stripDesignCopy(ELENA)).toBe("SMP winter entertainment promo. up to 20% off");
    expect(stripDesignCopy("Copy: Join us Friday for live music on the roof.")).toBe(
      "Join us Friday for live music on the roof.",
    );
  });

  it("uses Claude's copy and ignores a reply that repeats the lead-in", async () => {
    const llm: Llm = {
      async complete() {
        return { content: [{ type: "text", text: "{\"copy\":\"SMP winter entertainment promo. Up to 20% off\"}" }] };
      },
    };
    expect(await extractDesignCopy({ llm, text: ELENA })).toBe("SMP winter entertainment promo. Up to 20% off");

    const echo: Llm = {
      async complete() {
        return { content: [{ type: "text", text: `{"copy":${JSON.stringify(ELENA)}}` }] };
      },
    };
    expect(await extractDesignCopy({ llm: echo, text: ELENA })).toBe("SMP winter entertainment promo. up to 20% off");
  });

  it("stores only the clean copy when building from a thread reply", async () => {
    const state = emptyConversation("C1:thread");
    state.phase = "awaiting_design_materials";
    state.design = {
      candidates: [{
        id: "EAHMIHmQKsA",
        name: "Proper-Q1GroupOffer-2026",
        url: "https://www.canva.com/brand/brand-templates/EAHMIHmQKsA",
        useFor: "Group offer",
      }],
      templateId: "EAHMIHmQKsA",
      photos: [],
      version: 0,
    };
    let builtCopy = "";
    const llm: Llm = {
      async complete() {
        return { content: [{ type: "text", text: "{\"copy\":\"SMP winter entertainment promo. Up to 20% off\"}" }] };
      },
    };
    await runIntakeTurn({
      state,
      userText: `${ELENA}\nFiles: photo.png`,
      slackUser: { id: "U1", name: "Elena Ruiz" },
      llm,
      design: {
        canva: {
          connected: async () => true,
          build: async (input) => {
            builtCopy = input.copy;
            return { kind: "fallback", reason: NEEDS_TAGS_REASON };
          },
        },
        uploads: [{ source: "slack", slackFileId: "F0CEPQ96LJD", name: "photo.png" }],
        download: async () => ({ name: "photo.png", bytes: Uint8Array.from([1]) }),
      },
    });
    expect(builtCopy).toBe("SMP winter entertainment promo. Up to 20% off");
    expect(state.phase).toBe("template_offered");
  });

  it("says an untagged template needs editor tags and does not invent a design", () => {
    const text = formatDesignFallback({
      candidates: [{
        id: "EAHMIHmQKsA",
        name: "Proper-Q1GroupOffer-2026",
        url: "https://www.canva.com/brand/brand-templates/EAHMIHmQKsA",
        useFor: "Group offer",
      }],
      templateId: "EAHMIHmQKsA",
      copy: "SMP winter entertainment promo. Up to 20% off",
      photos: [],
      version: 0,
    }, NEEDS_TAGS_REASON);
    expect(text).toContain("https://www.canva.com/brand/brand-templates/EAHMIHmQKsA");
    expect(text).toContain("SMP winter entertainment promo. Up to 20% off");
    expect(text).toMatch(/Data field/);
    expect(text).toMatch(/cannot add those tags/);
    expect(text).not.toContain("here's the copy");
  });

  it("classifies datasets for the live template list", () => {
    expect(liveTemplates()).toHaveLength(55);
    const tagged = classifyDataset(
      { id: "EAHMIHmQKsA", name: "Proper-Q1GroupOffer-2026" },
      { Headline: { type: "text" }, Photo: { type: "image" } },
    );
    expect(tagged.status).toBe("fields");
    const untagged = classifyDataset({ id: "EAHMIHmQKsA", name: "Proper-Q1GroupOffer-2026" }, {});
    expect(untagged.status).toBe("none");
    expect(formatDatasetReport([tagged, untagged])).toContain("Untagged: 1");
  });
});

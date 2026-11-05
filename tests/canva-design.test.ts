import { describe, expect, it, vi } from "vitest";
import { runIntakeTurn, type DesignDeps, type Llm, type LlmContentBlock } from "../src/agent/run.js";
import { buildSystemPrompt } from "../src/agent/prompt.js";
import { downloadSlackFile } from "../src/slack/files.js";
import { RedisStore, type KeyValueClient } from "../src/store/redis.js";
import { emptyConversation } from "../src/store/types.js";

describe("building a Canva design in the thread", () => {
  it("waits for copy and photos, resumes the saved thread, then builds a fresh version on edit", async () => {
    const llm = scripted([{
      type: "tool_use",
      id: "toolu_1",
      name: "record_answers",
      input: {
        requestType: "Social",
        taskType: "Feed Post Request",
        properties: ["SMP"],
        requestName: "Weekly happenings",
      },
    }]);
    const state = emptyConversation("C1:thread");
    const asked = await runIntakeTurn({
      state,
      userText: "Can we get weekly happenings up for SMP?",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm,
      today: new Date("2026-11-02T12:00:00Z"),
      design: fakeDesign(async () => ({ kind: "design", editUrl: "https://www.canva.com/design/unused/edit", viewUrl: "https://www.canva.com/design/unused/view", photosPlaced: true })),
    });
    expect(asked.text).toContain("final copy");
    expect(asked.text).toContain("photos");
    expect(asked.text).toContain("marketing manager");
    expect(asked.text).toContain("same thread");
    expect(state.phase).toBe("awaiting_design_materials");
    expect(state.design?.templateId).toBe("EAHJyAsHwPs");

    const store = redisStore();
    await store.saveConversation(state);
    const loaded = await store.getConversation("C1:thread");
    expect(loaded?.design?.templateId).toBe("EAHJyAsHwPs");
    expect(loaded?.phase).toBe("awaiting_design_materials");

    const waiting = loaded ?? state;
    const held = await runIntakeTurn({
      state: waiting,
      userText: "I don't have the photos yet",
      slackUser: { id: "U1", name: "Elena Ruiz" },
      llm: scripted([{ type: "text", text: "should not be used" }]),
      design: fakeDesign(async () => {
        throw new Error("build should not run");
      }),
    });
    expect(held.text).toMatch(/marketing manager/);
    expect(held.text).toMatch(/same thread/);
    expect(waiting.phase).toBe("awaiting_design_materials");

    let builtCopy = "";
    const built = vi.fn(async (input: { copy: string }) => {
      builtCopy = input.copy;
      return {
        kind: "design" as const,
        editUrl: "https://www.canva.com/design/NEW/edit",
        viewUrl: "https://www.canva.com/design/NEW/view",
        photosPlaced: true,
      };
    });
    const downloads: string[] = [];
    const ready = await runIntakeTurn({
      state: waiting,
      userText: "Copy: Join us Friday for live music on the roof.\nFiles: roof.jpg",
      slackUser: { id: "U1", name: "Elena Ruiz" },
      llm: scripted([{ type: "text", text: "should not be used" }]),
      design: {
        ...fakeDesign(built),
        uploads: [{ source: "slack", slackFileId: "F123", name: "roof.jpg" }],
        download: async (photo) => {
          downloads.push(photo.slackFileId ?? photo.url ?? "");
          return { name: photo.name || "roof.jpg", bytes: Uint8Array.from([1, 2, 3]) };
        },
      },
    });
    expect(downloads).toEqual(["F123"]);
    expect(built).toHaveBeenCalledOnce();
    expect(builtCopy).toBe("Join us Friday for live music on the roof.");
    expect(ready.text).toContain("https://www.canva.com/design/NEW/edit");
    expect(ready.text).toContain("https://www.canva.com/design/NEW/view");
    expect(waiting.phase).toBe("design_ready");

    const revised = vi.fn(async (input: { copy: string }) => {
      expect(input.copy).toMatch(/Saturday sunset/);
      return {
        kind: "design" as const,
        editUrl: "https://www.canva.com/design/NEXT/edit",
        viewUrl: "https://www.canva.com/design/NEXT/view",
        photosPlaced: true,
      };
    });
    const edited = await runIntakeTurn({
      state: waiting,
      userText: "Change the headline to Saturday sunset.",
      slackUser: { id: "U1", name: "Elena Ruiz" },
      llm: scripted([{ type: "text", text: "should not be used" }]),
      design: fakeDesign(revised),
    });
    expect(edited.text).toMatch(/fresh version/);
    expect(edited.text).toContain("https://www.canva.com/design/NEXT/edit");
    expect(edited.text).not.toContain("https://www.canva.com/design/NEW/edit");
  });

  it("sends the template link and the copy when autofill is unavailable, then continues intake if it doesn't work", async () => {
    const state = emptyConversation("C1:2");
    state.phase = "awaiting_design_materials";
    state.design = {
      candidates: [{
        id: "EAHJyAsHwPs",
        name: "SMP-Happenings",
        url: "https://www.canva.com/brand/brand-templates/EAHJyAsHwPs",
        useFor: "Weekly happenings, SMP",
      }],
      templateId: "EAHJyAsHwPs",
      copy: "Join us Friday for live music on the roof.",
      photos: [{ source: "url", url: "https://cdn.example.com/roof.jpg", name: "roof.jpg" }],
      version: 0,
    };
    state.draft = {
      requestName: "Weekly happenings",
      properties: ["SMP"],
      requestType: "Social",
      taskType: "Feed Post Request",
    };
    const fallback = await runIntakeTurn({
      state,
      userText: "yes",
      slackUser: { id: "U1", name: "Elena Ruiz" },
      llm: scripted([{ type: "text", text: "unused" }]),
      design: fakeDesign(async () => ({ kind: "fallback", reason: "Canva autofill needs a plan that includes it (Canva Enterprise)" })),
    });
    expect(fallback.text).toContain("https://www.canva.com/brand/brand-templates/EAHJyAsHwPs");
    expect(fallback.text).toContain("Join us Friday");
    expect(fallback.text).toMatch(/team to design it/);
    expect(state.phase).toBe("template_offered");

    const declined = await runIntakeTurn({
      state,
      userText: "This template doesn't work. Please have the team design it.",
      slackUser: { id: "U1", name: "Elena Ruiz" },
      llm: scripted([{ type: "text", text: "Okay." }]),
      today: new Date("2026-11-02T12:00:00Z"),
    });
    expect(declined.text).toContain("*Your email*");
    expect(state.draft.templateUnusedReason).toMatch(/doesn't work/);
  });

  it("keeps sending the link only until Canva is connected", async () => {
    const state = emptyConversation("C1:3");
    const reply = await runIntakeTurn({
      state,
      userText: "Weekly happenings for SMP",
      slackUser: { id: "U1", name: "Elena Ruiz" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_2",
        name: "record_answers",
        input: { requestType: "Social", taskType: "Feed Post Request", properties: ["SMP"], requestName: "Weekly happenings" },
      }]),
      design: {
        canva: { connected: async () => false, build: async () => { throw new Error("not connected"); } },
        uploads: [],
        download: async () => { throw new Error("not connected"); },
      },
    });
    expect(reply.text).toContain("https://www.canva.com/brand/brand-templates/EAHJyAsHwPs");
    expect(reply.text).not.toContain("Before I start");
    expect(state.phase).toBe("template_offered");
  });

  it("downloads a Slack upload with the bot token", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-test");
      if (href.includes("files.info")) {
        return json({ ok: true, file: { name: "roof.jpg", url_private: "https://files.slack.com/roof.jpg" } });
      }
      return new Response(Uint8Array.from([9, 8, 7]), { status: 200 });
    });
    const file = await downloadSlackFile({
      token: "xoxb-test",
      fileId: "F123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(file.name).toBe("roof.jpg");
    expect(Array.from(file.bytes)).toEqual([9, 8, 7]);
  });

  it("tells Claude to wait for copy and photos on this thread", () => {
    const prompt = buildSystemPrompt(emptyConversation("C1:1"), { name: "Elena Ruiz" });
    expect(prompt).toContain("live Canva template map");
    expect(prompt).toContain("Archived and one-off templates are excluded");
    expect(prompt).toContain("final copy");
    expect(prompt).toContain("photos");
    expect(prompt).toContain("same thread");
    expect(prompt).toContain("accept_template");
    expect(prompt).toContain("decline_template");
    expect(prompt).not.toContain("EAHHycjf7Ug");
  });

  it("builds only the live press template and refuses an archived id", async () => {
    const state = emptyConversation("C1:press");
    const build = vi.fn(async (input: { templateId: string }) => {
      expect(input.templateId).toBe("EAHVrNTlM1M");
      return {
        kind: "design" as const,
        editUrl: "https://www.canva.com/design/PRESS/edit",
        viewUrl: "https://www.canva.com/design/PRESS/view",
        photosPlaced: true,
      };
    });
    const asked = await runIntakeTurn({
      state,
      userText: "press feature for the new restaurant",
      slackUser: { id: "U1", name: "Elena Ruiz" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_press",
        name: "record_answers",
        input: {
          requestType: "Social",
          taskType: "Feed Post Request",
          properties: ["All Proper"],
          requestName: "Press feature",
        },
      }]),
      design: fakeDesign(build),
    });
    expect(asked.text).toContain("EAHVrNTlM1M");
    expect(asked.text).not.toContain("EAHHycjf7Ug");
    expect(state.design?.templateId).toBe("EAHVrNTlM1M");
    expect(state.design?.candidates.map((candidate) => candidate.id)).toEqual(["EAHVrNTlM1M"]);

    const archived = emptyConversation("C1:old");
    archived.phase = "awaiting_design_materials";
    archived.design = {
      candidates: [{
        id: "EAHHycjf7Ug",
        name: "Proper-Social-Press-2026",
        url: "https://www.canva.com/brand/brand-templates/EAHHycjf7Ug",
        useFor: "Press feature",
      }],
      templateId: "EAHHycjf7Ug",
      copy: "Join us Friday for the press preview.",
      photos: [{ source: "url", url: "https://cdn.example.com/press.jpg", name: "press.jpg" }],
      version: 0,
    };
    const refused = await runIntakeTurn({
      state: archived,
      userText: "yes",
      slackUser: { id: "U1", name: "Elena Ruiz" },
      llm: scripted([{ type: "text", text: "unused" }]),
      design: fakeDesign(async () => {
        throw new Error("archived template must not be built");
      }),
    });
    expect(refused.text).toMatch(/archived/);
    expect(archived.design).toBeUndefined();
    expect(archived.phase).toBe("collecting");
  });
});

function fakeDesign(build: DesignDeps["canva"]["build"]): DesignDeps {
  return {
    canva: { connected: async () => true, build },
    uploads: [],
    download: async (photo) => ({ name: photo.name || "photo.jpg", bytes: Uint8Array.from([1]) }),
  };
}

function scripted(content: LlmContentBlock[]): Llm {
  return { async complete() { return { content }; } };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function redisStore(): RedisStore {
  const data = new Map<string, string>();
  const client: KeyValueClient = {
    async get(key) { return data.get(key) ?? null; },
    async set(key, value, expiryMode, ttlSeconds, mode) {
      expect(expiryMode).toBe("EX");
      expect(ttlSeconds).toBeGreaterThan(0);
      if (mode === "NX" && data.has(key)) return null;
      data.set(key, value);
      return "OK";
    },
    async del(key) { return data.delete(key) ? 1 : 0; },
  };
  return new RedisStore(client);
}

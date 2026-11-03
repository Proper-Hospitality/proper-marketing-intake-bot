import { describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "../src/agent/prompt.js";
import { ARCHIVED_TEMPLATES } from "../src/intake/templates.js";
import { runIntakeTurn, type Llm, type LlmContentBlock } from "../src/agent/run.js";
import { FORM_URL } from "../src/intake/catalog.js";
import { ConfirmationRequiredError, submitConfirmedBrief } from "../src/slack/submit.js";
import { MemoryStore } from "../src/store/memory.js";
import { emptyConversation } from "../src/store/types.js";
import { confirmBlocks } from "../src/slack/blocks.js";

describe("confirmation gate", () => {
  it("encodes the field order and form, and does not name archived templates", () => {
    const prompt = buildSystemPrompt(emptyConversation("C1:1"), { name: "Elena Ruiz", email: "elena@example.com" });
    expect(prompt).toContain("1217171671548482");
    expect(prompt).toContain("requestType, taskType, property");
    expect(prompt).toContain(FORM_URL);
    expect(prompt).toContain("Archived and one-off templates are excluded");
    expect(prompt).toContain("Never say you created");
    for (const template of ARCHIVED_TEMPLATES) {
      expect(prompt).not.toContain(template.id);
    }
  });

  it("offers a template and does not call Asana or Anthropic beyond the scripted tool", async () => {
    const fetchImpl = vi.fn();
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
    const state = emptyConversation("C1:1");
    const reply = await runIntakeTurn({
      state,
      userText: "Can we get weekly happenings up for SMP?",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      today: new Date("2026-11-02T12:00:00Z"),
    });
    expect(reply.text).toContain("SMP-Happenings");
    expect(reply.text).toContain("https://www.canva.com/brand/brand-templates/EAHJyAsHwPs");
    expect(reply.confirm).toBeUndefined();
    expect(state.phase).toBe("template_offered");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stages a confirm summary for a complete no-template request and files only after confirmation", async () => {
    const llm = scripted([{
      type: "tool_use",
      id: "toolu_2",
      name: "record_answers",
      input: {
        requestType: "Creative",
        taskType: "Email",
        properties: ["SMP"],
        requestName: "Holiday newsletter",
        requestedCompletionDate: "2026-12-01",
        consequenceOfDelay: "Members miss the sale.",
        approver: "DeeDee Brown",
        whereItGoesLive: "Members email",
        assets: ["https://drive.example.com/photo"],
        followUps: {
          "Audience / Distribution Plan": "Members",
          "Recommended Copy / Details": "Join us this December.",
        },
      },
    }]);
    const state = emptyConversation("D1:dm");
    const reply = await runIntakeTurn({
      state,
      userText: "Need a holiday email designed for SMP.",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm,
      today: new Date("2026-11-02T12:00:00Z"),
    });
    expect(reply.confirm?.version).toBe(1);
    expect(reply.text).toContain("Nothing is filed until you click");
    expect(reply.text).toContain("Creative → Email");
    expect(state.phase).toBe("awaiting_confirm");

    const store = new MemoryStore();
    await store.saveConversation(state);
    await expect(submitConfirmedBrief({
      confirmed: false,
      version: 1,
      state,
      store,
      token: "test",
    })).rejects.toBeInstanceOf(ConfirmationRequiredError);

    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      calls.push(init?.method ?? "GET");
      if ((init?.method ?? "GET") === "POST") return json({ data: { gid: "T1" } });
      if (init?.method === "PUT") return json({ data: { gid: "T1" } });
      return json({
        data: {
          gid: "T1",
          permalink_url: "https://app.asana.com/0/1/T1",
          memberships: [
            { project: { gid: "1217171684008018", name: "New Intake Board" }, section: { name: "New requests - Submitted via Form" } },
            { project: { gid: "Q", name: "New Creative Queue" }, section: { name: "New Request" } },
          ],
          custom_fields: [
            { name: "Request Type_New Intake Board", display_value: "Creative" },
            { name: "Creative Task Type", display_value: "Email" },
            { name: "Property List_New Intake Board", display_value: "SMP" },
            { name: "Status in Que", display_value: "New Request" },
            { name: "Estimated time", display_value: "4h" },
          ],
        },
      });
    });
    const filed = await submitConfirmedBrief({
      confirmed: true,
      version: 1,
      state,
      store,
      token: "test-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(calls).toEqual(["POST", "PUT", "PUT", "PUT", "GET"]);
    expect(filed.text).toContain("https://app.asana.com/0/1/T1");
    const again = await submitConfirmedBrief({
      confirmed: true,
      version: 1,
      state,
      store,
      token: "test-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(again.text).toContain("already filed");
    expect(calls).toEqual(["POST", "PUT", "PUT", "PUT", "GET"]);
  });

  it("continues the brief when the template is declined in plain language", async () => {
    const llm = scripted([{ type: "text", text: "Okay." }]);
    const state = emptyConversation("C1:9");
    state.phase = "template_offered";
    state.templateOffer = {
      matches: [{
        id: "EAHJyAsHwPs",
        name: "SMP-Happenings",
        useFor: "Weekly happenings, SMP",
        url: "https://www.canva.com/brand/brand-templates/EAHJyAsHwPs",
        score: 1,
      }],
      duplicateName: false,
      needsProperty: false,
    };
    state.draft = {
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@example.com",
      requestName: "Weekly happenings",
      properties: ["SMP"],
      requestType: "Social",
      taskType: "Feed Post Request",
    };
    const reply = await runIntakeTurn({
      state,
      userText: "That template doesn't fit. Please have the team design it.",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm,
      today: new Date("2026-11-02T12:00:00Z"),
    });
    expect(state.draft.templateUnusedReason).toMatch(/doesn't fit/);
    expect(reply.text).toContain("Recommended Copy / Details");
    expect(reply.confirm).toBeUndefined();
  });

  it("builds a confirm message with one primary button", () => {
    const blocks = confirmBlocks("Please confirm this marketing request.", 3);
    const actions = blocks.find((block) => block.type === "actions");
    expect(actions && "elements" in actions && actions.elements).toHaveLength(2);
    const buttons = actions && "elements" in actions ? actions.elements : [];
    const primary = buttons.filter((element) => "style" in element && element.style === "primary");
    expect(primary).toHaveLength(1);
    expect(primary[0]).toMatchObject({ type: "button", action_id: "confirm_intake", value: "3" });
    for (const block of blocks) {
      if (block.type === "header") expect(block.text.text.length).toBeLessThanOrEqual(150);
      if (block.type === "section" && block.text && "text" in block.text) expect(block.text.text.length).toBeLessThanOrEqual(3000);
      if (block.type === "actions") {
        for (const element of block.elements) {
          if (element.type === "button" && "text" in element && element.text.type === "plain_text") {
            expect(element.text.text.length).toBeLessThanOrEqual(75);
          }
        }
      }
    }
  });
});

function scripted(content: LlmContentBlock[]): Llm {
  return {
    model: "test",
    async complete() {
      return { content };
    },
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

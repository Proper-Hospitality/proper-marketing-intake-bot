import { describe, expect, it, vi } from "vitest";
import { runIntakeTurn, type Llm, type LlmContentBlock } from "../src/agent/run.js";
import { extractPdfText } from "../src/intake/read-attachment.js";
import { extractDueDate } from "../src/intake/relative-date.js";
import { classifyRush } from "../src/intake/rush.js";
import { FORM_URL } from "../src/intake/catalog.js";
import { submitConfirmedBrief } from "../src/slack/submit.js";
import { MemoryStore } from "../src/store/memory.js";
import { emptyConversation } from "../src/store/types.js";
import type { BriefDraft } from "../src/intake/types.js";

const WEDNESDAY = new Date("2026-11-11T18:00:00Z");
const USER_FORM = "https://form.asana.com/?k=oduA9wxKyb7eUKrUW5-9EQ&d=555523431250044";

describe("relative due dates", () => {
  it("resolves this Friday, tomorrow, next Tuesday, and EOW in Pacific time", () => {
    expect(extractDueDate("It's due this Friday", WEDNESDAY)?.iso).toBe("2026-11-13");
    expect(extractDueDate("tomorrow", WEDNESDAY, { expectingDate: true })?.iso).toBe("2026-11-12");
    expect(extractDueDate("EOW", WEDNESDAY)?.iso).toBe("2026-11-13");
    expect(extractDueDate("end of week", WEDNESDAY)?.iso).toBe("2026-11-13");
    const monday = new Date("2026-11-09T18:00:00Z");
    expect(extractDueDate("next Tuesday", monday)?.iso).toBe("2026-11-17");
    expect(extractDueDate("this Tuesday", monday)?.iso).toBe("2026-11-10");
    expect(extractDueDate("Friday Nov 13, two days from now", WEDNESDAY)).toMatchObject({
      iso: "2026-11-13",
      relative: false,
    });
    expect(classifyRush("2026-11-13", WEDNESDAY)).toBeNull();
    expect(classifyRush("2026-11-12", WEDNESDAY)).toBe("next_day");
    expect(classifyRush("2026-11-14", WEDNESDAY)).toBe("weekend");
    const friday = new Date("2026-11-13T18:00:00Z");
    expect(extractDueDate("due Monday", friday)?.iso).toBe("2026-11-16");
    expect(classifyRush("2026-11-16", friday)).toBe("friday_monday");
  });

  it("confirms this Friday and does not ask for the date again", async () => {
    const state = emptyConversation("C:friday");
    state.draft = adDraft();
    state.phase = "collecting";
    const first = await runIntakeTurn({
      state,
      userText: "It's due this Friday and has to be officially submitted via the link here: " + USER_FORM,
      slackUser: { id: "U1", name: "Kinsey East", email: "kinsey@example.com" },
      llm: scripted([{ type: "text", text: "When do you need this, and what happens if it's late?" }]),
      today: WEDNESDAY,
    });
    expect(state.draft.requestedCompletionDate).toBe("2026-11-13");
    expect(state.draft.providedLinks).toContain(USER_FORM);
    expect(first.text).toContain("Fri Nov 13 — right?");
    expect(first.text).toContain("What happens if Basel Digital Signage Ad is late?");
    expect(first.text).not.toContain("When do you need this");
    expect(first.text).not.toContain("*Requested completion date*");

    const second = await runIntakeTurn({
      state,
      userText: "If its not submitted by Friday, we miss out on the opportunity.",
      slackUser: { id: "U1", name: "Kinsey East", email: "kinsey@example.com" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_why",
        name: "record_answers",
        input: { consequenceOfDelay: "If its not submitted by Friday, we miss out on the opportunity." },
      }]),
      today: WEDNESDAY,
    });
    expect(state.draft.requestedCompletionDate).toBe("2026-11-13");
    expect(state.draft.consequenceOfDelay).toMatch(/miss out on the opportunity/);
    expect(second.text).not.toContain("*Requested completion date*");
    expect(second.text).not.toContain("When do you need this");

    const third = await runIntakeTurn({
      state,
      userText: "Yes, why are you still asking?",
      slackUser: { id: "U1", name: "Kinsey East", email: "kinsey@example.com" },
      llm: scripted([{
        type: "text",
        text: "'This Friday' isn't a calendar date I can file, and I can't safely work out which Friday you mean. What's the exact date, for example 2026-05-15?",
      }]),
      today: WEDNESDAY,
    });
    expect(state.draft.requestedCompletionDate).toBe("2026-11-13");
    expect(third.text).not.toMatch(/calendar date|which Friday|2026-05-15/i);
    expect(third.text).not.toContain("*Requested completion date*");
  });

  it("asks only for the missing half of the timing question", async () => {
    const state = emptyConversation("C:half");
    state.draft = adDraft();
    state.phase = "collecting";
    state.lastAskedId = "timing";
    state.lastAskedLabel = "When do you need this, and what happens if it's late?";
    const reply = await runIntakeTurn({
      state,
      userText: "We miss out on the opportunity.",
      slackUser: { id: "U1", name: "Kinsey East", email: "kinsey@example.com" },
      llm: scripted([{ type: "text", text: "When do you need this, and what happens if it's late?" }]),
      today: WEDNESDAY,
    });
    expect(state.draft.consequenceOfDelay).toMatch(/miss out on the opportunity/);
    expect(state.draft.requestedCompletionDate).toBeUndefined();
    expect(reply.text).toContain("If it's late: We miss out on the opportunity.");
    expect(reply.text).toContain("When do you need Basel Digital Signage Ad?");
    expect(reply.text).not.toContain("When do you need this, and what happens if it's late?");
  });

  it("keeps rush approval for next-day, Friday-to-Monday, and weekend dates", async () => {
    const nextDay = emptyConversation("C:tomorrow");
    nextDay.draft = adDraft();
    nextDay.phase = "collecting";
    const tomorrow = await runIntakeTurn({
      state: nextDay,
      userText: "tomorrow",
      slackUser: { id: "U1", name: "Kinsey East" },
      llm: scripted([{ type: "text", text: "Send a YYYY-MM-DD date." }]),
      today: WEDNESDAY,
    });
    expect(nextDay.draft.requestedCompletionDate).toBe("2026-11-12");
    expect(nextDay.draft.rushBlock).toBe("next_day");
    expect(tomorrow.text).toContain("Thu Nov 12 — right?");
    expect(tomorrow.text).toContain("next day");
    expect(tomorrow.text).toContain("Request approval");
    expect(tomorrow.text).not.toContain("YYYY-MM-DD");

    const weekend = emptyConversation("C:sat");
    weekend.draft = adDraft();
    const saturday = await runIntakeTurn({
      state: weekend,
      userText: "this Saturday",
      slackUser: { id: "U1", name: "Kinsey East" },
      llm: scripted([{ type: "text", text: "unused" }]),
      today: WEDNESDAY,
    });
    expect(weekend.draft.rushBlock).toBe("weekend");
    expect(saturday.text).toContain("Sat Nov 14 — right?");
    expect(saturday.text).toMatch(/Saturday or Sunday/);
    expect(saturday.text).not.toContain("Request approval");

    const friday = new Date("2026-11-13T18:00:00Z");
    const monday = emptyConversation("C:mon");
    monday.draft = adDraft();
    const dueMonday = await runIntakeTurn({
      state: monday,
      userText: "due Monday",
      slackUser: { id: "U1", name: "Kinsey East" },
      llm: scripted([{ type: "text", text: "unused" }]),
      today: friday,
    });
    expect(monday.draft.requestedCompletionDate).toBe("2026-11-16");
    expect(monday.draft.rushBlock).toBe("friday_monday");
    expect(dueMonday.text).toContain("Request approval");
    expect(dueMonday.text).toContain("Mon Nov 16 — right?");
  });
});

describe("slack attachments on the intake task", () => {
  it("reads a spec sheet and uploads the Slack file onto the Asana task", async () => {
    const pdf = Buffer.from(
      "%PDF-1.1\n1 0 obj<<>>endobj\n2 0 obj<< /Length 44 >>stream\nBT (Digital signage 9x16 vertical) Tj ET\nendstream\nendobj\n",
      "utf8",
    );
    expect(extractPdfText(pdf)).toContain("9x16");

    const state = emptyConversation("C:file");
    state.draft = {
      requesterName: "Kinsey East",
      requesterEmail: "kinsey@example.com",
    };
    const opening = await runIntakeTurn({
      state,
      userText: `create a creative task for a digital ad for Basel for SMB. Include the attachment. Assets Specs: Digital signage screens 85", 9x16 ratio, vertical. It's due this Friday.`,
      slackUser: { id: "U1", name: "Kinsey East", email: "kinsey@example.com" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_ad",
        name: "record_answers",
        input: {
          requestName: "Basel Digital Signage Ad",
          properties: ["SMB"],
          requestType: "Creative",
          taskType: "Ad",
          approver: "DeeDee Brown",
          whereItGoesLive: "Digital signage",
          followUps: {
            "Audience / Distribution Plan": "SMB guests",
            "Recommended Copy / Details": "Basel digital ad",
          },
        },
      }]),
      today: WEDNESDAY,
      attachments: [{
        slackFileId: "F-SPEC",
        name: "image.png",
        permalink: "https://properhospitalitycorp.slack.com/files/F-SPEC/image.png",
        mimetype: "image/png",
      }],
      readAttachment: async () => 'Digital signage screens 85", 9x16 ratio, vertical.',
    });
    expect(state.draft.attachments?.[0]).toMatchObject({
      slackFileId: "F-SPEC",
      name: "image.png",
      permalink: "https://properhospitalitycorp.slack.com/files/F-SPEC/image.png",
    });
    expect(state.draft.attachments?.[0].specs).toContain("9x16");
    expect(state.draft.followUps?.["Asset Size"]).toContain("9x16");
    expect(state.draft.requestedCompletionDate).toBe("2026-11-13");
    expect(opening.text).not.toMatch(/can'?t open attachments/i);
    expect(opening.text).not.toContain("*Asset Size*");

    state.draft.consequenceOfDelay = "We miss the placement.";
    state.phase = "awaiting_confirm";
    state.confirmVersion = 1;
    const calls: Array<{ url: string; method: string; notes?: string; form: boolean }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      calls.push({
        url: href,
        method,
        notes: typeof init?.body === "string" ? init.body : undefined,
        form: typeof FormData !== "undefined" && init?.body instanceof FormData,
      });
      if (href.includes("files.info")) {
        return json({
          ok: true,
          file: {
            name: "image.png",
            mimetype: "image/png",
            permalink: "https://properhospitalitycorp.slack.com/files/F-SPEC/image.png",
            url_private: "https://files.slack.com/image.png",
          },
        });
      }
      if (href.includes("files.slack.com")) return new Response(Uint8Array.from([1, 2, 3]));
      if (method === "POST" && href.endsWith("/tasks")) return json({ data: { gid: "T-AD" } });
      if (method === "POST" && href.includes("/attachments")) return json({ data: { gid: "ATT1" } });
      if (method === "PUT") return json({ data: { gid: "T-AD" } });
      return json({
        data: {
          gid: "T-AD",
          permalink_url: "https://app.asana.com/0/1/T-AD",
          memberships: [
            { project: { gid: "1217171684008018", name: "New Intake Board" }, section: { name: "New requests - Submitted via Form" } },
          ],
          custom_fields: [
            { name: "Request Type_New Intake Board", display_value: "Creative" },
            { name: "Creative Task Type", display_value: "Ad" },
            { name: "Property List_New Intake Board", display_value: "SMB" },
            { name: "Status in Que", display_value: "New Request" },
            { name: "Estimated time", display_value: "2h" },
          ],
        },
      });
    });
    const store = new MemoryStore();
    await store.saveConversation(state);
    const filed = await submitConfirmedBrief({
      confirmed: true,
      version: 1,
      state,
      store,
      token: "asana-token",
      slackToken: "xoxb-test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const created = calls.find((call) => call.method === "POST" && call.url.endsWith("/tasks"));
    expect(created?.notes).toContain("https://properhospitalitycorp.slack.com/files/F-SPEC/image.png");
    expect(created?.notes).toContain("9x16");
    expect(calls.some((call) => call.method === "POST" && call.url.includes("/tasks/T-AD/attachments") && call.form)).toBe(true);
    expect(state.uploadedSlackFileIds).toContain("F-SPEC");
    expect(filed.text).toContain("https://app.asana.com/0/1/T-AD");
    expect(filed.text).toContain("image.png");
  });
});

describe("replies after a task is filed", () => {
  it("keeps the filed task link and the requester's form URL", async () => {
    const state = emptyConversation("C:filed");
    state.phase = "submitted";
    state.taskGid = "T-AD";
    state.taskUrl = "https://app.asana.com/0/1/T-AD";
    state.uploadedSlackFileIds = ["F-SPEC"];
    state.draft = {
      ...adDraft(),
      requestName: "Basel Digital Signage Ad",
      requestedCompletionDate: "2026-11-13",
      consequenceOfDelay: "We miss the placement.",
      providedLinks: [USER_FORM],
      whereItGoesLive: USER_FORM,
      attachments: [{
        slackFileId: "F-SPEC",
        name: "image.png",
        permalink: "https://properhospitalitycorp.slack.com/files/F-SPEC/image.png",
      }],
    };
    const llm: Llm = {
      async complete() {
        throw new Error("should not ask the model after the task is filed");
      },
    };
    const reply = await runIntakeTurn({
      state,
      userText: "@Elena looks like it isn't taking attachments? Also review the asking questions multiple times issue",
      slackUser: { id: "U1", name: "Kinsey East", email: "kinsey@example.com" },
      llm,
      today: WEDNESDAY,
    });
    expect(reply.text).toContain("already filed");
    expect(reply.text).toContain("https://app.asana.com/0/1/T-AD");
    expect(reply.text).toContain("image.png");
    expect(reply.text).toContain(USER_FORM);
    expect(reply.text).not.toContain("Nothing is filed");
    expect(reply.text).not.toContain(FORM_URL);
    expect(reply.confirm).toBeUndefined();
  });
});

function adDraft(): BriefDraft {
  return {
    requesterName: "Kinsey East",
    requesterEmail: "kinsey@example.com",
    requestName: "Basel Digital Signage Ad",
    properties: ["SMB"],
    requestType: "Creative",
    taskType: "Ad",
    approver: "DeeDee Brown",
    whereItGoesLive: "Digital signage",
    assets: ["https://drive.example.com/ref"],
    followUps: {
      "Audience / Distribution Plan": "SMB guests",
      "Recommended Copy / Details": "Basel digital ad",
      "Asset Size": "85 inch, 9x16, vertical",
    },
  };
}

function scripted(content: LlmContentBlock[]): Llm {
  return { async complete() { return { content }; } };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

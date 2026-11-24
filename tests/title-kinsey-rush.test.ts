import { describe, expect, it } from "vitest";
import { handleIncomingMessage } from "../src/slack/handle.js";
import type { SlackApi } from "../src/slack/api.js";
import type { Llm, LlmContentBlock } from "../src/agent/run.js";
import { buildDescription, taskName } from "../src/intake/brief.js";
import { keepExactReply } from "../src/intake/capture.js";
import { applyAnswers } from "../src/intake/flow.js";
import { applyRushBlock } from "../src/intake/relative-date.js";
import { applyRushDecision, startRushApproval } from "../src/intake/rush-approval.js";
import { rushApproverFor, rushExplanation } from "../src/intake/rush.js";
import { submitConfirmedBrief } from "../src/slack/submit.js";
import { MemoryStore } from "../src/store/memory.js";
import { emptyConversation } from "../src/store/types.js";
import type { BriefDraft } from "../src/intake/types.js";

const CHANNEL = "C0CEMM9G9EW";
const PARENT = "1794864493.879639";
const NAME = "Test AI. | MIN email";
const TODAY = new Date("2026-11-16T18:00:00Z");
const FILES = [1, 2, 3].map((n) => ({
  id: `F${n}`,
  name: `Group ${n}.png`,
  mimetype: "image/png",
  permalink: `https://properhospitalitycorp.slack.com/files/F${n}/group${n}.png`,
}));

describe("request name stays free of file summaries", () => {
  it("keeps a later name answer exact when the first message uploaded files", async () => {
    const store = new MemoryStore();
    const posts: string[] = [];
    const slack = slackApi(posts);
    const opening: Llm = {
      async complete() {
        return {
          content: [{
            type: "tool_use",
            id: "toolu_open",
            name: "record_answers",
            input: {
              properties: ["MIN"],
              requestType: "CRM & Paid",
              taskType: "Newsletter Send",
              requestedCompletionDate: "2026-12-20",
              consequenceOfDelay: "We miss the send.",
              approver: "Kinsey East",
              followUps: {
                "Audience / Distribution Plan": "Minnesota Database",
                "Recommended Copy / Details": "slices attached",
                "CTA Links": "http://properhotel.com/minneapolis",
              },
            },
          } satisfies LlmContentBlock],
        };
      },
    };
    await handleIncomingMessage({ store, slack, llm: opening, today: TODAY }, {
      channel: CHANNEL,
      userId: "U-ELENA",
      text: "email for minneapolis",
      ts: PARENT,
      isDm: false,
      uploads: FILES.map((file) => ({ source: "slack" as const, slackFileId: file.id, name: file.name, permalink: file.permalink, mimetype: file.mimetype })),
    });
    const opened = await store.getConversation(`${CHANNEL}:${PARENT}`);
    expect(opened?.draft.attachments?.map((file) => file.name)).toEqual(["Group 1.png", "Group 2.png", "Group 3.png"]);
    expect(opened?.draft.requestName).toBeUndefined();
    if (opened) {
      opened.phase = "collecting";
      opened.lastAskedId = "requestName";
      await store.saveConversation(opened);
    }

    const naming: Llm = {
      async complete() {
        return {
          content: [{
            type: "tool_use",
            id: "toolu_name",
            name: "record_answers",
            input: {
              requestName: `${NAME} Files attached (saved on this request): Group 3.png https://properhospitalitycorp.slack.com/files/F3/group3.png, Group 2.png https://properhospitalitycorp.slack.com/files/F2/group2.png, Group 1.png https://properhospitalitycorp.slack.com/files/F1/group1.png`,
            },
          } satisfies LlmContentBlock],
        };
      },
    };
    await handleIncomingMessage({ store, slack, llm: naming, today: TODAY }, {
      channel: CHANNEL,
      userId: "U-ELENA",
      text: NAME,
      ts: "1794864500.100000",
      threadTs: PARENT,
      isDm: false,
      uploads: [],
    });
    const named = await store.getConversation(`${CHANNEL}:${PARENT}`);
    expect(named?.draft.requestName).toBe(NAME);
    expect(taskName(named!.draft)).toBe(`MIN, ${NAME}`);
    const notes = buildDescription({ draft: named!.draft, templateOffer: null });
    expect(notes).toContain(`Request Name:\n${NAME}`);
    expect(notes).not.toContain("Files attached");
    expect(notes).not.toMatch(/slack\.com\/files/i);
    expect(posts.join("\n")).not.toContain("Files attached");
    expect(posts.join("\n")).not.toMatch(/slack\.com\/files/i);
  });

  it("strips a file echo from a stored name and from the filed confirmation", async () => {
    const polluted = `${NAME} Files attached (saved on this request): Group 1.png https://properhospitalitycorp.slack.com/files/F1/group1.png\nFiles: Group 1.png (F1ABC123)`;
    const draft: BriefDraft = { properties: ["MIN"], requestName: "placeholder" };
    keepExactReply(draft, "requestName", polluted);
    expect(draft.requestName).toBe(NAME);
    expect(taskName(draft)).toBe(`MIN, ${NAME}`);

    const state = emptyConversation("C:filed-clean");
    state.phase = "awaiting_confirm";
    state.confirmVersion = 1;
    state.draft = {
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@properhotel.com",
      requestName: "Local Announcement Email",
      properties: ["MIN"],
      requestType: "CRM & Paid",
      taskType: "Newsletter Send",
      requestedCompletionDate: "2026-12-20",
      consequenceOfDelay: "We miss the announcement.",
      approver: "Kinsey East",
      requesterSlackId: "U-ELENA",
      followUps: {
        "Audience / Distribution Plan": "Minnesota Database",
        "Recommended Copy / Details": "slices attached",
        "CTA Links": "http://properhotel.com/minneapolis",
      },
      attachments: [1, 2, 3].map((n) => ({
        slackFileId: `F${n}`,
        name: `Group ${n}.png`,
        ref: `Group ${n}.png`,
        mimetype: "image/png",
        permalink: `https://properhospitalitycorp.slack.com/files/F${n}/group${n}.png`,
      })),
    };
    const store = new MemoryStore();
    await store.saveConversation(state);
    const filed = await submitConfirmedBrief({
      confirmed: true,
      version: 1,
      state,
      store,
      token: "asana",
      slackToken: "xoxb-test",
      fetchImpl: asanaFetch() as unknown as typeof fetch,
    });
    expect(filed.text).toBe([
      "Filed *MIN, Local Announcement Email*",
      "https://app.asana.com/0/1/T-MIN",
      "Attached: Group 1.png, Group 2.png, Group 3.png.",
    ].join("\n"));
    expect(filed.text).not.toMatch(/slack\.com\/files/i);
    expect(filed.text).not.toMatch(/Files:/);
    expect(state.uploadedSlackFileIds).toEqual(["F1", "F2", "F3"]);
  });
});

describe("Kinsey approves new-property rushes", () => {
  it("asks only Kinsey for a new property, including a 24 hour send, and skips her own requests", async () => {
    const today = TODAY;
    const other: BriefDraft = {
      properties: ["MIN"],
      requestType: "CRM & Paid",
      taskType: "Newsletter Send",
      requestedCompletionDate: "2026-11-17",
      requesterEmail: "elena@properhotel.com",
      requesterSlackId: "U-ELENA",
    };
    applyRushBlock(other, today);
    expect(other.rushBlock).toBe("next_day");
    expect(rushApproverFor(other.properties)).toMatchObject({ name: "Kinsey East", id: "U0ANYBQHGCR" });
    expect(rushExplanation("next_day", "2026-11-17", "Kinsey East")).toContain("I'll ask Kinsey East");

    const sameDay: BriefDraft = { ...other, requestedCompletionDate: "2026-11-16" };
    applyRushBlock(sameDay, today);
    expect(sameDay.rushBlock).toBe("same_day");

    const weekend: BriefDraft = { ...other, requestedCompletionDate: "2026-11-21" };
    applyRushBlock(weekend, today);
    expect(weekend.rushBlock).toBe("weekend");

    const hers: BriefDraft = { ...other, requesterSlackId: "U0ANYBQHGCR", requestedCompletionDate: "2026-11-17" };
    applyRushBlock(hers, today);
    expect(hers.rushBlock).toBeUndefined();
    const herSameDay: BriefDraft = { ...hers, requestedCompletionDate: "2026-11-16" };
    applyRushBlock(herSameDay, today);
    expect(herSameDay.rushBlock).toBeUndefined();
    const herWeekend: BriefDraft = { ...hers, requestedCompletionDate: "2026-11-21" };
    applyRushBlock(herWeekend, today);
    expect(herWeekend.rushBlock).toBe("weekend");

    const otherProperty: BriefDraft = { ...other, properties: ["SMP"] };
    applyRushBlock(otherProperty, today);
    expect(otherProperty.rushBlock).toBeUndefined();
    expect(rushApproverFor(["SMP"]).name).toBe("DeeDee Brown");
    expect(rushApproverFor(["LTP", "DAL", "New Projects/Development"]).name).toBe("Kinsey East");

    const state = emptyConversation("C:kinsey-rush");
    state.draft = other;
    const store = new MemoryStore();
    await store.saveConversation(state);
    const dms: string[] = [];
    await startRushApproval({
      state,
      store,
      date: "2026-11-17",
      reason: "next_day",
      summary: "Elena needs a MIN email tomorrow.",
      channel: CHANNEL,
      postDm: async (userId) => { dms.push(userId); },
    });
    expect(dms).toEqual(["U0ANYBQHGCR"]);
    const refused = await applyRushDecision({
      store,
      approvalId: state.draft.rushApprovalId ?? "",
      approverId: "U0B6N3RE23T",
      decision: "approved",
    });
    expect(refused.ok).toBe(false);
    expect(refused.text).toContain("Only Kinsey East");
    const approved = await applyRushDecision({
      store,
      approvalId: state.draft.rushApprovalId ?? "",
      approverId: "U0ANYBQHGCR",
      decision: "approved",
    });
    expect(approved.text).toContain("Rush approved by Kinsey East");
    const saved = await store.getConversation("C:kinsey-rush");
    expect(saved?.draft.rushApprovedBy).toBe("Kinsey East");
    expect(saved?.draft.rushBlock).toBeUndefined();

    const ready = emptyConversation("C:kinsey-files");
    const outcome = applyAnswers(ready, {
      requesterName: "Kinsey East",
      requesterEmail: "kinsey.east@properhotel.com",
      requestName: "Local Announcement Email",
      properties: ["MIN"],
      requestType: "CRM & Paid",
      taskType: "Newsletter Send",
      requestedCompletionDate: "2026-11-17",
      consequenceOfDelay: "has to be sent tomorrow - most send tasks will be 24 hour turnaround. that's normal.",
      followUps: {
        "Audience / Distribution Plan": "Minnesota Database",
        "Recommended Copy / Details": "slices attached",
        "CTA Links": "http://properhotel.com/minneapolis",
      },
      attachments: [{ ref: "slices.png", fileName: "slices.png", kind: "email_slice" }],
    }, today);
    expect(outcome.kind).toBe("hard_question");
    expect(ready.draft.rushBlock).toBeUndefined();
  });
});

function slackApi(posts: string[]): SlackApi {
  return {
    async postMessage(args) {
      posts.push(args.text);
      return { ts: "posted" };
    },
    async updateMessage() {},
    async userProfile() {
      return { name: "Elena Ruiz", email: "elena@properhotel.com" };
    },
    async threadReplies() {
      return [{
        ts: PARENT,
        user: "U-ELENA",
        text: "email for minneapolis",
        files: FILES,
      }];
    },
  };
}

function asanaFetch(): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";
    if (href.includes("files.info")) {
      const id = new URL(href).searchParams.get("file") ?? "file";
      return json({
        ok: true,
        file: {
          name: `Group ${id.slice(1)}.png`,
          mimetype: "image/png",
          permalink: `https://properhospitalitycorp.slack.com/files/${id}/group.png`,
          url_private: `https://files.slack.com/${id}`,
        },
      });
    }
    if (href.includes("files.slack.com")) return new Response(Uint8Array.from([1]));
    if (method === "POST" && href.endsWith("/tasks")) return json({ data: { gid: "T-MIN" } });
    if (method === "POST" && href.includes("/attachments")) return json({ data: { gid: "ATT" } });
    if (method === "GET" && href.includes("/attachments")) return json({ data: [] });
    if (method === "PUT") return json({ data: { gid: "T-MIN" } });
    if (method === "POST" && href.includes("/stories")) return json({ data: {} });
    return json({
      data: {
        gid: "T-MIN",
        permalink_url: "https://app.asana.com/0/1/T-MIN",
        memberships: [
          { project: { gid: "1217171684008018", name: "New Intake Board" }, section: { name: "New requests - Submitted via Form" } },
        ],
        custom_fields: [
          { name: "Request Type_New Intake Board", display_value: "CRM & Paid" },
          { name: "CRM & Paid Task Type", display_value: "Newsletter Send" },
          { name: "Property List_New Intake Board", display_value: "MIN" },
          { name: "Status in Que", display_value: "New Request" },
          { name: "Estimated time", display_value: "1h" },
        ],
      },
    });
  }) as unknown as typeof fetch;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

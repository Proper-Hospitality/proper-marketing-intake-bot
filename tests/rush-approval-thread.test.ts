import { describe, expect, it } from "vitest";
import { runIntakeTurn, type Llm } from "../src/agent/run.js";
import { fieldQuestion } from "../src/intake/ask-text.js";
import { inferPlacement } from "../src/intake/capture.js";
import { messageSuppliesDate } from "../src/intake/relative-date.js";
import { wantsRushApproval } from "../src/intake/rush.js";
import { handleConfirmAction } from "../src/slack/handle.js";
import { MemoryStore } from "../src/store/memory.js";
import { emptyConversation } from "../src/store/types.js";

const TODAY = new Date("2026-11-11T22:32:00Z");
const KINSEY = "build a design task for a new homepage element for SMB, due tomorrow. It goes in the 3rd homepage spot. Should say Medium Cool. Needs their team's approval. https://drive.google.com/file/d/medium-cool";

const recordType: Llm = {
  async complete() {
    return {
      content: [{
        type: "tool_use",
        id: "toolu_home",
        name: "record_answers",
        input: {
          requestName: "Homepage element",
          properties: ["SMB"],
          requestType: "Creative",
          taskType: "Web Page",
          requestedCompletionDate: "today",
        },
      }],
    };
  },
};

describe("Kinsey's Nov 11 homepage rush", () => {
  it("asks DeeDee and Koral, keeps tomorrow, and does not announce filing", async () => {
    expect(wantsRushApproval("Request Approval")).toBe(true);
    expect(wantsRushApproval("*Request approval*")).toBe(true);
    expect(wantsRushApproval("please request approval")).toBe(true);
    expect(wantsRushApproval("yes ask them")).toBe(true);
    expect(wantsRushApproval("you said you would ask them?")).toBe(true);
    expect(wantsRushApproval("ask them")).toBe(true);
    expect(messageSuppliesDate("you said you would ask them?")).toBe(false);
    expect(inferPlacement(KINSEY)).toBe("the homepage, 3rd spot");

    const state = emptyConversation("C0CEMM9G9EW:1794436375.974449");
    state.channel = "C0CEMM9G9EW";
    state.threadTs = "1794436375.974449";
    const store = new MemoryStore();
    const dms: string[] = [];
    const rush = {
      store,
      channel: state.channel,
      threadTs: state.threadTs,
      postDm: async (userId: string) => { dms.push(userId); },
    };
    const previousMentions = process.env.SLACK_MENTIONS_ENABLED;
    process.env.SLACK_MENTIONS_ENABLED = "false";
    try {
      const first = await runIntakeTurn({
        state,
        userText: KINSEY,
        slackUser: { id: "U0ANYBQHGCR", name: "Kinsey East", email: "kinsey@properhotel.com" },
        llm: recordType,
        today: TODAY,
        rush,
      });
      expect(state.draft.requestedCompletionDate).toBe("2026-11-12");
      expect(state.draft.followUps?.["Audience / Distribution Plan"]).toBe("the homepage, 3rd spot");
      expect(state.draft.followUps?.["Recommended Copy / Details"]).toBe("Medium Cool");
      expect(first.text).toContain("2026-11-12 is the next day");
      expect(first.text).toContain("Request approval");
      expect(first.text).toContain("We need:");
      expect(first.text).not.toContain("membership interest list");
      expect(first.blocks?.some((block) => block.type === "actions")).toBe(true);

      const asked = await runIntakeTurn({
        state,
        userText: "Request Approval",
        slackUser: { id: "U0ANYBQHGCR", name: "Kinsey East" },
        llm: { async complete() { throw new Error("approval must not ask Claude"); } },
        today: TODAY,
        rush,
      });
      expect(dms).toEqual(["U0B5F1HN98Q", "U0B6N3RE23T"]);
      expect(asked.text).toContain("I've asked DeeDee Brown and Koral Captain");
      expect(asked.text).toContain("direct message");
      expect(asked.text).toContain("as soon as one approves");
      expect(asked.text).not.toContain("membership interest list");
      expect(asked.text).not.toContain("weekly newsletter");
      expect(state.draft.requestedCompletionDate).toBe("2026-11-12");
      const saved = await store.getValue(`intake:rush:${state.draft.rushApprovalId}`);
      expect(saved).toContain("pending");
      await store.saveConversation(state);
      const reloaded = await store.getConversation(state.key);
      expect(reloaded?.draft.rushApprovalId).toBe(state.draft.rushApprovalId);
      expect(reloaded?.draft.requestedCompletionDate).toBe("2026-11-12");

      const complaint = await runIntakeTurn({
        state,
        userText: "you said you would ask them?",
        slackUser: { id: "U0ANYBQHGCR", name: "Kinsey East" },
        llm: {
          async complete() {
            return {
              content: [{
                type: "tool_use",
                id: "toolu_bad_date",
                name: "record_answers",
                input: { requestedCompletionDate: "2026-11-11" },
              }],
            };
          },
        },
        today: TODAY,
        rush,
      });
      expect(state.draft.requestedCompletionDate).toBe("2026-11-12");
      expect(complaint.text).not.toContain("2026-11-11 is the same day");
      expect(complaint.text).toContain("already asked");
      expect(dms).toHaveLength(2);

      const bold = await runIntakeTurn({
        state,
        userText: "*Request approval*",
        slackUser: { id: "U0ANYBQHGCR", name: "Kinsey East" },
        llm: { async complete() { throw new Error("bold approval must not ask Claude"); } },
        today: TODAY,
        rush,
      });
      expect(state.draft.requestedCompletionDate).toBe("2026-11-12");
      expect(bold.text).not.toContain("2026-11-12 is the next day");
      expect(bold.text).toContain("already asked");
      expect(dms).toHaveLength(2);
    } finally {
      if (previousMentions === undefined) delete process.env.SLACK_MENTIONS_ENABLED;
      else process.env.SLACK_MENTIONS_ENABLED = previousMentions;
    }

    state.phase = "awaiting_confirm";
    state.confirmVersion = 1;
    await store.saveConversation(state);
    const updates: string[] = [];
    const posts: string[] = [];
    await handleConfirmAction({
      store,
      asanaToken: "asana-token",
      slack: {
        async postMessage(args) { posts.push(args.text); return {}; },
        async updateMessage(args) { updates.push(args.text); },
        async userProfile() { return { name: "Kinsey East" }; },
        async threadReplies() { return []; },
      },
    }, {
      version: 1,
      channel: "C0CEMM9G9EW",
      messageTs: "confirm-1",
      threadTs: "1794436375.974449",
    });
    expect(updates).toEqual([]);
    expect(posts.join("\n")).toContain("Nothing was created");
    expect(posts.join("\n")).not.toContain("Filing this");
  });

  it("uses a homepage example for a web page, and a newsletter example only for email", () => {
    const web = fieldQuestion(
      { id: "followup:Audience / Distribution Plan", label: "Audience / Distribution Plan" },
      { requestName: "Homepage element", taskType: "Web Page", properties: ["SMB"] },
    );
    expect(web).toContain("homepage");
    expect(web).not.toContain("weekly newsletter");
    const email = fieldQuestion(
      { id: "followup:Audience / Distribution Plan", label: "Audience / Distribution Plan" },
      { requestName: "Members note", taskType: "Email", properties: ["SMB"] },
    );
    expect(email).toContain("weekly newsletter");
  });
});

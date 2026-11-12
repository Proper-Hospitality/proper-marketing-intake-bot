import { describe, expect, it } from "vitest";
import { runIntakeTurn, type Llm, type LlmContentBlock } from "../src/agent/run.js";
import { buildDescription } from "../src/intake/brief.js";
import { isBackAnswer, isSkipAnswer } from "../src/intake/conversation.js";
import { listMissing } from "../src/intake/missing.js";
import { emptyConversation } from "../src/store/types.js";

describe("one question at a time", () => {
  it("asks only the next missing field and acknowledges the last answer", async () => {
    const state = emptyConversation("C1:1");
    const first = await runIntakeTurn({
      state,
      userText: "I need a holiday email",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_start",
        name: "record_answers",
        input: {},
      }]),
      today: new Date("2026-11-02T12:00:00Z"),
    });
    expect(first.text).toContain("We need:");
    expect(first.text).toContain("a short name for the request");
    expect(first.text).toContain("which property this is for");

    const second = await runIntakeTurn({
      state,
      userText: "Holiday newsletter",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_name",
        name: "record_answers",
        input: { requestName: "Holiday newsletter" },
      }]),
      today: new Date("2026-11-02T12:00:00Z"),
    });
    expect(second.text).toContain("which property this is for");
    expect(second.text).not.toContain("a short name for the request");
    expect(state.lastAskedId).toBe("batch");
  });

  it("records several answers at once, then skips and goes back", async () => {
    expect(isSkipAnswer("not sure")).toBe(true);
    expect(isBackAnswer("go back")).toBe(true);
    const state = emptyConversation("C1:2");
    state.draft = {
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@example.com",
      requestName: "Holiday newsletter",
      properties: ["SMP"],
      requestType: "Creative",
      taskType: "Email",
    };
    state.phase = "collecting";
    state.lastAskedId = "followup:Audience / Distribution Plan";
    state.lastAskedLabel = "Audience / Distribution Plan";
    const skipped = await runIntakeTurn({
      state,
      userText: "skip",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: scripted([{ type: "text", text: "should not be needed" }]),
      today: new Date("2026-11-02T12:00:00Z"),
    });
    expect(skipped.text).toContain("before I can file");
    expect(state.draft.skipped).toBeUndefined();

    state.lastAskedId = "followup:Recommended Copy / Details";
    state.lastAskedLabel = "Recommended Copy / Details";
    const many = await runIntakeTurn({
      state,
      userText: "Join us in December. DeeDee approves. It goes in the members email. Photo is https://drive.example.com/a",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: scripted([{
        type: "tool_use",
        id: "toolu_many",
        name: "record_answers",
        input: {
          followUps: {
            "Recommended Copy / Details": "Join us in December.",
            "Photo Link": "https://drive.example.com/a",
            "CTA Link": "Members email",
          },
          approver: "DeeDee Brown",
          whereItGoesLive: "Members email",
        },
      }]),
      today: new Date("2026-11-02T12:00:00Z"),
    });
    expect(many.text).toContain("when this needs to be live");
    expect(many.text).not.toContain("*Final approver*");
    expect(listMissing(state.draft, new Date("2026-11-02T12:00:00Z")).items.map((item) => item.id)).toEqual([
      "followup:Audience / Distribution Plan",
      "requestedCompletionDate",
      "attachmentKind:0",
    ]);

    const back = await runIntakeTurn({
      state,
      userText: "back",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm: scripted([{ type: "text", text: "no" }]),
      today: new Date("2026-11-02T12:00:00Z"),
    });
    expect(back.text).toContain("Let's change that.");
    expect(back.text).toContain("the copy, or the key points");
    expect(state.draft.followUps?.["Recommended Copy / Details"]).toBeUndefined();
    expect(state.draft.followUps?.["CTA Link"]).toBe("Members email");
  });

  it("keeps skipped answers out of the brief and in Pending from requester", () => {
    const description = buildDescription({
      draft: {
        requesterName: "Elena Ruiz",
        requesterEmail: "elena@example.com",
        requestName: "Holiday newsletter",
        properties: ["SMP"],
        requestType: "Creative",
        taskType: "Email",
        requestedCompletionDate: "2026-12-01",
        consequenceOfDelay: "Members miss the sale.",
        approver: "DeeDee Brown",
        whereItGoesLive: "Members email",
        followUps: { "Recommended Copy / Details": "Join us in December." },
        skipped: [{ id: "followup:Audience / Distribution Plan", label: "Audience / Distribution Plan" }],
      },
      templateOffer: null,
    });
    expect(description).toContain("## Brief\nRecommended Copy / Details: Join us in December.");
    expect(description).toContain("## Pending from requester\nAudience / Distribution Plan: Not sure (requester will provide)");
    expect(description).not.toContain("Audience / Distribution Plan: Not sure (requester will provide)\n## Brief");
  });
});

function scripted(content: LlmContentBlock[]): Llm {
  return { async complete() { return { content }; } };
}

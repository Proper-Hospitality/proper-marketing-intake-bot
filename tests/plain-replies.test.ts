import { describe, expect, it } from "vitest";
import { runIntakeTurn, type Llm, type LlmContentBlock } from "../src/agent/run.js";
import {
  AUDIENCE_QUESTION,
  CLICK_QUESTION,
  FILE_QUESTION,
  MESSAGE_LIMIT,
  TEXT_QUESTION,
  plainFollowUp,
} from "../src/intake/easy-chat.js";
import { classifyNewAsset } from "../src/intake/new-asset.js";
import { emptyConversation } from "../src/store/types.js";

const MONDAY = new Date("2026-11-23T16:00:00Z");
const JARGON = /\b(assets|distribution plan|deliverable|creative)\b/i;
const ELENA = { id: "U1", name: "Elena Ruiz", email: "elena@example.com" };

describe("plain simplified questions", () => {
  it("says files, wording, the click, and who should get it without intake jargon", () => {
    expect(FILE_QUESTION).toBe("What images or photos should we use? Attach them here, share a link, or say none.");
    expect(plainFollowUp("Photo Link", {})).toBe(FILE_QUESTION);
    expect(plainFollowUp("Link to Organized Assets", {})).toBe(FILE_QUESTION);
    expect(TEXT_QUESTION).toBe("What should the text (copy) say?");
    expect(plainFollowUp("Recommended Copy / Details", {})).toBe(TEXT_QUESTION);
    expect(CLICK_QUESTION).toBe("What button or link should people click (CTA)?");
    expect(plainFollowUp("CTA Link", {})).toBe(CLICK_QUESTION);
    expect(FILE_QUESTION).not.toMatch(/\bassets\b/i);
    expect(AUDIENCE_QUESTION).toBe("Who should get this, and where will they see it?");
    expect(plainFollowUp("Audience / Distribution Plan", {})).toBe(AUDIENCE_QUESTION);
    for (const prompt of [FILE_QUESTION, TEXT_QUESTION, CLICK_QUESTION, AUDIENCE_QUESTION]) {
      expect(prompt).not.toMatch(JARGON);
      expect(prompt.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    }
  });

  it("talks through an SMB pricing edit in short plain messages", async () => {
    const state = emptyConversation("C:smb-pricing");
    state.intakeFlow = "simplified";
    const first = await runIntakeTurn({
      state,
      userText: "i want to edit the pricing of the group promo at smb website",
      slackUser: ELENA,
      llm: scripted([{
        type: "tool_use",
        id: "toolu_edit",
        name: "record_answers",
        input: {
          requestType: "Web",
          taskType: "Page Edit",
          properties: ["SMB"],
          requestName: "Group promo pricing",
          notes: "i want to edit the pricing of the group promo at smb website",
        },
      }]),
      today: MONDAY,
    });
    expect(first.text).toBe(
      "Got it, a page edit on the SMB site to update the group promo pricing. What's the link to the current page, and what should the new pricing text (copy) say?",
    );
    expect(first.text).not.toMatch(/Thank you for your request|We need:|I have this so far|•/);
    expect(first.text).not.toMatch(JARGON);
    expect(first.text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);

    const second = await runIntakeTurn({
      state,
      userText: "https://www.properhotel.com/shelborne/groups and groups start at $199",
      slackUser: ELENA,
      llm: scripted([{ type: "text", text: "should not be used" }]),
      today: MONDAY,
    });
    expect(second.text).toBe("What images or photos should we use? Attach them here, share a link, or say none.");
    expect(second.text).not.toMatch(/\bassets\b/i);
    expect(second.text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(state.draft.followUps?.URL).toBe("https://www.properhotel.com/shelborne/groups");
    expect(state.draft.followUps?.["Page Change Details (exact copy provided, if required)"]).toContain("$199");
    expect(state.draft.designNeeded).toBeUndefined();

    const photos = await runIntakeTurn({
      state,
      userText: "none",
      slackUser: ELENA,
      llm: scripted([{ type: "text", text: "should not be used" }]),
      today: MONDAY,
    });
    expect(photos.text).toBe("Do you need design help? If not, say no.");
    expect(state.draft.assets).toEqual(["none"]);

    const design = await runIntakeTurn({
      state,
      userText: "no",
      slackUser: ELENA,
      llm: scripted([{ type: "text", text: "should not be used" }]),
      today: MONDAY,
    });
    expect(design.text).toBe("What should come down, and where should this sit on the page?");
    expect(state.draft.designNeeded).toBe(false);

    const replaces = await runIntakeTurn({
      state,
      userText: "It replaces the current group promo price on that page.",
      slackUser: ELENA,
      llm: scripted([{ type: "text", text: "should not be used" }]),
      today: MONDAY,
    });
    expect(replaces.text).toBe("When does it need to be live? Page edits usually take about 3 working days.");

    const third = await runIntakeTurn({
      state,
      userText: "December 15",
      slackUser: ELENA,
      llm: scripted([{ type: "text", text: "should not be used" }]),
      today: MONDAY,
    });
    expect(third.text).toBe(
      "I can file this SMB website change for the group promo pricing, live Dec 15. Click Confirm and I'll create the task.",
    );
    expect(third.text).not.toMatch(/Page Edit|Creative|assets|copy|CTA|deliverable/i);
    expect(third.text).not.toMatch(/•|We need:/);
    expect(third.text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(third.confirm?.version).toBeGreaterThan(0);
  });

  it("leaves the classic checklist alone", async () => {
    const state = emptyConversation("C:classic-pricing");
    const reply = await runIntakeTurn({
      state,
      userText: "i want to edit the pricing of the group promo at smb website",
      slackUser: ELENA,
      llm: scripted([{
        type: "tool_use",
        id: "toolu_classic",
        name: "record_answers",
        input: {
          requestType: "Web",
          taskType: "Page Edit",
          properties: ["SMB"],
          requestName: "Group promo pricing",
          notes: "i want to edit the pricing of the group promo at smb website",
        },
      }]),
      today: MONDAY,
    });
    expect(reply.text).toContain("Thank you for your request");
    expect(reply.text).toContain("We need:");
    expect(reply.text).toContain("whether the copy is ready");
  });
});

describe("send an email is a new request", () => {
  it("treats send, create, make, new, and build as a new asset", () => {
    expect(classifyNewAsset("I want to send a email for SMB")).toMatchObject({
      requestType: "Creative", taskType: "Email", novelty: "new", properties: ["SMB"],
    });
    expect(classifyNewAsset("create an email for the hotel")?.novelty).toBe("new");
    expect(classifyNewAsset("make a new social post")?.taskType).toBe("Feed Post Request");
    expect(classifyNewAsset("build a landing page")?.taskType).toBe("New Page");
    expect(classifyNewAsset("new menu for SMB")?.taskType).toBe("Menu (F&B, Spa)");
    expect(classifyNewAsset("edit the pricing of the group promo")).toBeUndefined();
  });

  it("asks for approval before any design-or-send choice", async () => {
    const state = emptyConversation("C:send-email");
    state.intakeFlow = "simplified";
    const first = await runIntakeTurn({
      state,
      userText: "I want to send a email for SMB",
      slackUser: ELENA,
      llm: { async complete() { throw new Error("the model must not ask design versus send first"); } },
      today: MONDAY,
    });
    expect(first.text).toBe([
      "This is a new request, so it needs approval from <@U0B6N3RE23T>.",
      "- What do you need this for? For example, a promotion, an event, or to drive bookings.",
      "- How will we know it worked? For example, more bookings, sign-ups, or clicks.",
      "- Is there a budget for this? If not, just say no.",
    ].join("\n"));
    expect(first.text).not.toMatch(/designed or only sent|which to file first|design, send, or both|two tasks/i);
    expect(first.text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);

    const next = await runIntakeTurn({
      state,
      userText: "A note to past guests about winter rates.\nMore bookings from past guests.\nNo.",
      slackUser: ELENA,
      llm: { async complete() { throw new Error("scripted"); } },
      today: MONDAY,
    });
    expect(next.text).toBe("Is the email already designed?");
    expect(state.draft.businessProblem).toContain("winter rates");
    expect(state.draft.successLooksLike).toContain("More bookings");
    expect(state.draft.budget).toBe("No.");

    const designed = await runIntakeTurn({
      state,
      userText: "No",
      slackUser: ELENA,
      llm: { async complete() { throw new Error("scripted"); } },
      today: MONDAY,
    });
    expect(designed.text).toMatch(/Who should get this|text \(copy\)|images or photos/);
    expect(designed.text).not.toMatch(/two tasks|which first|design, send, or both/);
    expect(designed.text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(state.draft.companionTaskType).toBe("Newsletter Send");
  });
});

function scripted(content: LlmContentBlock[]): Llm {
  return { async complete() { return { content }; } };
}

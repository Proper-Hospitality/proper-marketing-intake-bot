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
import { emptyConversation } from "../src/store/types.js";

const MONDAY = new Date("2026-11-23T16:00:00Z");
const JARGON = /\b(assets|copy|CTA|distribution plan|deliverable|creative)\b/i;
const ELENA = { id: "U1", name: "Elena Ruiz", email: "elena@example.com" };

describe("plain simplified questions", () => {
  it("says files, wording, the click, and who should get it without intake jargon", () => {
    expect(FILE_QUESTION).toBe("What images or files should we use? You can attach them here or share a link.");
    expect(plainFollowUp("Photo Link", {})).toBe(FILE_QUESTION);
    expect(plainFollowUp("Link to Organized Assets", {})).toBe(FILE_QUESTION);
    expect(TEXT_QUESTION).toBe("What should the text say?");
    expect(plainFollowUp("Recommended Copy / Details", {})).toBe(TEXT_QUESTION);
    expect(CLICK_QUESTION).toBe("What button or link should people click?");
    expect(plainFollowUp("CTA Link", {})).toBe(CLICK_QUESTION);
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
      "Got it, a page edit on the SMB site to update the group promo pricing. What's the link to the page, and what should the new pricing say?",
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
    expect(second.text).toBe("When does it need to be live? Page edits usually take about 3 working days.");
    expect(second.text).not.toMatch(JARGON);
    expect(second.text).not.toMatch(/design|images or files/i);
    expect(second.text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(state.draft.followUps?.URL).toBe("https://www.properhotel.com/shelborne/groups");
    expect(state.draft.followUps?.["Page Change Details (exact copy provided, if required)"]).toContain("$199");
    expect(state.draft.designNeeded).toBe(false);

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

function scripted(content: LlmContentBlock[]): Llm {
  return { async complete() { return { content }; } };
}

import { describe, expect, it } from "vitest";
import { formatNeedsList, shortNeed } from "../src/intake/ask-text.js";
import { isTeammateChatter, isVagueAnswer, parseBatchAnswers, saysNewPage } from "../src/intake/batch.js";
import { applyAnswers } from "../src/intake/flow.js";
import { listMissing } from "../src/intake/missing.js";
import { runIntakeTurn, type Llm } from "../src/agent/run.js";
import { emptyConversation } from "../src/store/types.js";

const TODAY = new Date("2026-11-11T20:00:00Z");
const llm: Llm = { async complete() { return { content: [] }; } };

describe("batched intake", () => {
  it("lists every missing detail and offers to answer them together", () => {
    const draft = {
      requesterName: "Jamie Mark",
      requesterEmail: "jamie.mark@properhotel.com",
      requestName: "Lake Tahoe membership interest form",
      properties: ["LTP"],
      requestType: "Web" as const,
      taskType: "Page Edit",
    };
    const items = listMissing(draft, TODAY).items;
    const text = formatNeedsList({ items, draft, opening: true });
    expect(text).toContain("Thank you for your request");
    expect(text).toContain("We need:");
    expect(text).toContain("• the link to the current page");
    expect(text).toContain("when this needs to be live");
    expect(text).toContain("answer all of these now");
    expect(text).not.toContain("*URL*");
    expect(shortNeed(items.find((item) => item.label === "URL") ?? items[0], draft)).toBe("the link to the current page");
  });

  it("fills several answers from one reply and does not re-ask them", async () => {
    const state = emptyConversation("C:batch");
    state.phase = "collecting";
    state.lastAskedId = "batch";
    state.draft = {
      requesterName: "Jamie Mark",
      requesterEmail: "jamie.mark@properhotel.com",
      requestName: "Lake Tahoe membership interest form",
      properties: ["LTP"],
      requestType: "Web",
      taskType: "Page Edit",
    };
    const reply = await runIntakeTurn({
      state,
      userText: "Due Dec 4. If it's late we miss the membership launch. Approver is Jamie Mark. https://www.properhotel.com/lake-tahoe/membership",
      slackUser: { id: "UJAMIE", name: "Jamie Mark" },
      llm,
      today: TODAY,
    });
    expect(state.draft.requestedCompletionDate).toBe("2026-12-04");
    expect(state.draft.consequenceOfDelay).toMatch(/miss the membership launch/);
    expect(state.draft.approver).toBe("Jamie Mark");
    expect(state.draft.followUps?.URL).toContain("properhotel.com/lake-tahoe/membership");
    expect(reply.text).not.toContain("• the link to the current page");
    expect(reply.text).not.toContain("• when this is due");
  });

  it("switches a page edit to a new page instead of asking for the current URL again", async () => {
    const state = emptyConversation("C:newpage");
    state.phase = "collecting";
    state.lastAskedId = "followup:URL";
    state.draft = {
      requesterName: "Jamie Mark",
      requesterEmail: "jamie.mark@properhotel.com",
      requestName: "Lake Tahoe membership interest form",
      properties: ["LTP"],
      requestType: "Web",
      taskType: "Page Edit",
    };
    const reply = await runIntakeTurn({
      state,
      userText: "It's a new page",
      slackUser: { id: "UJAMIE", name: "Jamie Mark" },
      llm,
      today: TODAY,
    });
    expect(state.draft.taskType).toBe("New Page");
    expect(saysNewPage("It's a new page")).toBe(true);
    expect(reply.text).toContain("new");
    expect(reply.text).not.toContain("current Lake Tahoe membership page");
    const still = listMissing(state.draft, TODAY).items.map((item) => item.label);
    expect(still).toContain("URL");
  });

  it("challenges a vague answer and will not file it", async () => {
    const state = emptyConversation("C:vague");
    state.phase = "collecting";
    state.lastAskedId = "followup:URL";
    state.lastAskedLabel = "URL";
    state.draft = {
      requesterName: "Jamie Mark",
      requesterEmail: "jamie.mark@properhotel.com",
      requestName: "Lake Tahoe membership interest form",
      properties: ["LTP"],
      requestType: "Web",
      taskType: "Page Edit",
    };
    const first = await runIntakeTurn({
      state,
      userText: "to our page",
      slackUser: { id: "UJAMIE", name: "Jamie Mark" },
      llm,
      today: TODAY,
    });
    expect(first.text).toContain("specific");
    expect(first.confirm).toBeUndefined();
    const second = await runIntakeTurn({
      state,
      userText: "not sure",
      slackUser: { id: "UJAMIE", name: "Jamie Mark" },
      llm,
      today: TODAY,
    });
    expect(second.text).toContain("before I can file");
    expect(second.confirm).toBeUndefined();
    expect(state.draft.followUps?.URL).toBeUndefined();
    expect(isVagueAnswer("it's fine")).toBe(true);
  });

  it("stays quiet when the thread is just tagging teammates", async () => {
    const state = emptyConversation("C:chat");
    state.phase = "awaiting_confirm";
    state.messages.push({ role: "assistant", content: "Want me to file this?" });
    state.draft = { requestName: "Lake Tahoe membership interest form", properties: ["LTP"] };
    const reply = await runIntakeTurn({
      state,
      userText: "<@UKINSEY> <@UROWAN> thoughts?",
      slackUser: { id: "UELENA", name: "Elena Ruiz" },
      llm,
      today: TODAY,
    });
    expect(isTeammateChatter("<@UKINSEY> <@UROWAN> thoughts?")).toBe(true);
    expect(reply.silent).toBe(true);
    expect(reply.confirm).toBeUndefined();
  });

  it("does not warn that an email date in another field is already past", () => {
    const report = listMissing({
      requesterName: "Jamie",
      requesterEmail: "jamie@properhotel.com",
      requestName: "Form",
      properties: ["LTP"],
      requestType: "Web",
      taskType: "Page Edit",
      requestedCompletionDate: "2026-12-04",
      consequenceOfDelay: "We miss the launch.",
      approver: "Jamie Mark",
      followUps: {
        URL: "https://www.properhotel.com/lake-tahoe/membership",
        "Page Change Details (exact copy provided, if required)": "Add the new fields.",
        "Event Date(s)": "2026-11-09",
      },
    }, TODAY);
    expect(report.warnings.join(" ")).not.toContain("2026-11-09");
    expect(report.warnings.join(" ")).not.toContain("requested date");
  });
});

describe("batch parser", () => {
  it("reads a due date, a consequence, and a page link from one note", () => {
    const parsed = parseBatchAnswers(
      "Due Dec 4. If it's late we miss the launch. https://www.properhotel.com/lake-tahoe/membership",
      { requestType: "Web", taskType: "Page Edit" },
      TODAY,
    );
    expect(parsed.requestedCompletionDate).toBe("2026-12-04");
    expect(parsed.consequenceOfDelay).toMatch(/miss the launch/);
    expect(parsed.followUps?.URL).toContain("lake-tahoe");
    const ready = applyAnswers({
      draft: {
        requesterName: "Jamie",
        requesterEmail: "jamie@properhotel.com",
        requestName: "Form",
        properties: ["LTP"],
        requestType: "Web",
        taskType: "Page Edit",
        approver: "Jamie",
      },
      phase: "collecting",
      templateOffer: null,
      confirmVersion: 0,
    }, parsed, TODAY);
    expect(ready.kind === "ask" || ready.kind === "confirm").toBe(true);
  });
});

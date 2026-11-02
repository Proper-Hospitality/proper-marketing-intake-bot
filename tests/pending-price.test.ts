import { describe, expect, it, vi } from "vitest";
import { runIntakeTurn, type Llm } from "../src/agent/run.js";
import { buildDescription, formatSummary } from "../src/intake/brief.js";
import { applyAnswers } from "../src/intake/flow.js";
import { isReadyToConfirm, listMissing, PRICE_PENDING_LINE } from "../src/intake/missing.js";
import { emptyConversation } from "../src/store/types.js";
import type { BriefDraft } from "../src/intake/types.js";

const today = new Date("2026-11-02T12:00:00Z");
const MENU = "Exact Menu Details with Pricing & Dietary Labels";

describe("pending prices", () => {
  it("does not treat a pending price as a missing answer when the rest of the field is filled", () => {
    const state = emptyConversation("C1:menu");
    const outcome = applyAnswers(state, {
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@example.com",
      requestName: "Dinner menu update",
      properties: ["SMP"],
      requestType: "Creative",
      taskType: "Menu (F&B, Spa)",
      requestedCompletionDate: "2026-12-01",
      consequenceOfDelay: "The dinner service has no menu.",
      approver: "DeeDee Brown",
      whereItGoesLive: "In-room dining",
      assets: ["https://drive.example.com/menu"],
      pricePending: true,
      followUps: {
        [MENU]: "Test burger. Don't have the price yet, will send it later.",
      },
    }, today);
    expect(outcome.kind).toBe("confirm");
    expect(state.draft.pricePending).toBe(true);
    expect(listMissing(state.draft, today).items).toEqual([]);
    expect(isReadyToConfirm(state.draft, today)).toBe(true);
    const labels = listMissing(state.draft, today).items.map((item) => item.label);
    expect(labels).not.toContain(MENU);
  });

  it("still requires the menu details and other fields when only the price was given as pending", () => {
    const pendingOnly = listMissing({
      ...baseMenu(),
      followUps: { [MENU]: "Still waiting on pricing." },
      pricePending: true,
    }, today);
    expect(pendingOnly.items.map((item) => item.label)).toContain(MENU);
    expect(pendingOnly.items.map((item) => item.label)).not.toContain("Price");

    const missingApprover = listMissing({
      ...baseMenu(),
      approver: undefined,
      pricePending: true,
      followUps: { [MENU]: "Test burger $16" },
    }, today);
    expect(missingApprover.items.map((item) => item.label)).toEqual(["Final approver"]);

    const offer = listMissing({
      requestType: "Marketing",
      taskType: "Offers",
      requesterName: "Elena Ruiz",
      requesterEmail: "elena@example.com",
      requestName: "Winter offer",
      properties: ["AUP"],
      requestedCompletionDate: "2026-12-01",
      consequenceOfDelay: "The offer cannot go live.",
      approver: "DeeDee Brown",
      pricePending: true,
      followUps: {
        "Offer Title (match Namastay)": "Winter Escape",
        "Offer Inclusions": "Breakfast for two",
        "Promo Code": "TBD",
        "Rate Code": "WINTER",
        "Offer Terms & Conditions (match Namastay)": "Blackout dates apply.",
        "Does the Standard Cancellation Policy Apply?": "Yes",
        "Offer Go Live Date": "2026-12-01",
      },
    }, today);
    expect(offer.items.map((item) => item.label)).toContain("Promo Code");
  });

  it("writes the requester's words, a full date, the pending line, and one template line", () => {
    const draft: BriefDraft = {
      ...baseMenu(),
      pricePending: true,
      notes: "Requester wants a new dinner menu. The handle is missing a year.",
      templateUnusedReason: "does not fit",
      followUps: {
        [MENU]: "Test burger $16",
        "Link to Current Menu": "https://example.com/menu",
      },
    };
    const description = buildDescription({
      draft,
      templateOffer: {
        matches: [{
          id: "EAG_kd17cpk",
          name: "5X7_ProperEventMenu",
          useFor: "Event menu",
          url: "https://www.canva.com/brand/brand-templates/EAG_kd17cpk",
          score: 1,
        }],
        duplicateName: false,
        needsProperty: false,
      },
    });
    const brief = description.split("## Brief\n")[1]?.split("\n\n")[0];
    expect(brief).toBe(`${MENU}: Test burger $16\nLink to Current Menu: https://example.com/menu`);
    expect(description).toContain("## Pending from requester\nPrice: TBD (requester will provide)");
    expect(description).toContain(PRICE_PENDING_LINE);
    expect(description).toContain("Canva template offered: 5X7_ProperEventMenu https://www.canva.com/brand/brand-templates/EAG_kd17cpk. Not used: does not fit.");
    expect(description).not.toContain("Requester wants");
    expect(description).not.toContain("missing a year");

    const dated = buildDescription({
      draft: {
        requestType: "Marketing",
        taskType: "Offers",
        followUps: { "Offer Go Live Date": "2026-12-01" },
      },
      templateOffer: null,
    });
    expect(dated).toContain("Offer Go Live Date: December 1, 2026");

    const summary = formatSummary({ draft, warnings: [], templateOffer: null, duplicates: [] });
    expect(summary).toContain(PRICE_PENDING_LINE);
    expect(summary).toContain("Reply in the Asana task or in this thread with the price when you have it.");
  });

  it("adds a later price from the same thread as a comment on the Asana task", async () => {
    const calls: Array<{ url: string; body?: { data?: { text?: string } } }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    const state = emptyConversation("C1:priced");
    state.phase = "submitted";
    state.taskGid = "T9";
    state.taskUrl = "https://app.asana.com/0/1/T9";
    state.draft.pricePending = true;
    const llm: Llm = { async complete() { throw new Error("should not ask Claude"); } };
    const reply = await runIntakeTurn({
      state,
      userText: "The test burger is $16",
      slackUser: { id: "U1", name: "Elena Ruiz", email: "elena@example.com" },
      llm,
      asanaToken: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/tasks/T9/stories");
    expect(calls[0].body?.data?.text).toBe("Price from Slack (Elena Ruiz, elena@example.com): The test burger is $16");
    expect(reply.text).toContain("https://app.asana.com/0/1/T9");
    expect(reply.confirm).toBeUndefined();
    expect(state.draft.pricePending).toBe(false);
  });
});

function baseMenu(): BriefDraft {
  return {
    requesterName: "Elena Ruiz",
    requesterEmail: "elena@example.com",
    requestName: "Dinner menu update",
    properties: ["SMP"],
    requestType: "Creative",
    taskType: "Menu (F&B, Spa)",
    requestedCompletionDate: "2026-12-01",
    consequenceOfDelay: "The dinner service has no menu.",
    approver: "DeeDee Brown",
    whereItGoesLive: "In-room dining",
    assets: ["https://drive.example.com/menu"],
  };
}

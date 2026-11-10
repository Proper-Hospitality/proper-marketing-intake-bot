import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runIntakeTurn } from "../src/agent/run.js";
import { buildDescription } from "../src/intake/brief.js";
import { applyAnswers } from "../src/intake/flow.js";
import { LET_MARKETING_RECOMMEND } from "../src/intake/recommend.js";
import { applyRushDecision, startRushApproval } from "../src/intake/rush-approval.js";
import { classifyRush, rushApprovers } from "../src/intake/rush.js";
import { isReadyToConfirm } from "../src/intake/missing.js";
import { submitConfirmedBrief } from "../src/slack/submit.js";
import { MemoryStore } from "../src/store/memory.js";
import { emptyConversation as blank } from "../src/store/types.js";

const scripted = { async complete() { return { content: [{ type: "text" as const, text: "unused" }] }; } };

describe("Elena's Nov 10 intake decisions", () => {
  it("asks them to go get an unknown answer before offering Let marketing recommend", async () => {
    const state = blank("C:recommend");
    state.phase = "collecting";
    state.lastAskedId = "followup:Asset Size";
    state.lastAskedLabel = "Asset Size";
    state.draft = {
      requesterName: "Alex",
      requesterEmail: "alex@example.com",
      requestName: "Banner",
      properties: ["SMP"],
      requestType: "Creative",
      taskType: "Ad",
    };
    const first = await runIntakeTurn({
      state,
      userText: "not sure",
      slackUser: { id: "UANY", name: "Alex" },
      llm: scripted,
      today: new Date("2026-11-10T20:00:00Z"),
    });
    expect(first.text).toContain("go get the actual answer");
    expect(first.text).not.toContain(LET_MARKETING_RECOMMEND);
    expect(state.lastAskedId).toBe("followup:Asset Size");
    expect(state.draft.followUps?.["Asset Size"]).toBeUndefined();

    const second = await runIntakeTurn({
      state,
      userText: "I still can't get it",
      slackUser: { id: "UANY", name: "Alex" },
      llm: scripted,
      today: new Date("2026-11-10T20:00:00Z"),
    });
    expect(second.text).toContain(LET_MARKETING_RECOMMEND);

    const recorded = await runIntakeTurn({
      state,
      userText: "Let marketing recommend",
      slackUser: { id: "UANY", name: "Alex" },
      llm: scripted,
      today: new Date("2026-11-10T20:00:00Z"),
    });
    expect(state.draft.followUps?.["Asset Size"]).toBe(LET_MARKETING_RECOMMEND);
    const description = buildDescription({ draft: state.draft, templateOffer: null });
    expect(description).toContain("Asset Size: Let marketing recommend");
    expect(description).not.toContain("Dimensions: Let marketing recommend\n## Brief");
    expect(recorded.text.length).toBeGreaterThan(0);
  });

  it("lets any Slack user submit and has no allowlist", () => {
    const source = walk("src").join("\n");
    expect(source).not.toMatch(/allowlist|ALLOWED_USERS|only Elena may/i);
    expect(submitConfirmedBrief.toString()).not.toMatch(/slackUser|userId|allowlist/i);
    expect(rushApprovers({}).map((person) => person.id)).toEqual(["U0B5F1HN98Q", "U0B6N3RE23T"]);
    for (const name of ["Alex Guest", "Pat Vendor"]) {
      expect(isReadyToConfirm({ ...completeDraft(), requesterName: name }, new Date("2026-11-10T20:00:00Z"))).toBe(true);
    }
  });

  it("asks when existing vs modified is unclear, then follows that choice", () => {
    const today = new Date("2026-11-10T20:00:00Z");
    const state = blank("C:route");
    const asked = applyAnswers(state, {
      requesterName: "Alex",
      requesterEmail: "alex@example.com",
      requestName: "Fact sheet",
      properties: ["SMP"],
      requestType: "Creative",
      taskType: "Sales Collateral",
    }, today);
    expect(asked.kind).toBe("ask_deliverable");
    state.draft.deliverableIntent = "existing";
    const existing = applyAnswers(state, {}, today);
    expect(existing.kind === "offer_collateral" || existing.kind === "ask_collateral_year").toBe(true);
    const modified = blank("C:mod");
    modified.draft.deliverableIntent = "modification";
    const change = applyAnswers(modified, {
      requesterName: "Alex",
      requesterEmail: "alex@example.com",
      requestName: "Update the fact sheet",
      properties: ["SMP"],
      requestType: "Creative",
      taskType: "Sales Collateral",
    }, today);
    expect(change.kind).toBe("offer_template");
  });

  it("blocks next-day and Friday-into-Monday dates, and files only after approval", async () => {
    const friday = new Date("2026-11-06T20:00:00Z");
    expect(classifyRush("2026-11-07", friday)).toBe("weekend");
    expect(classifyRush("2026-11-08", friday)).toBe("weekend");
    expect(classifyRush("2026-11-09", friday)).toBe("friday_monday");
    expect(classifyRush("2026-11-10", friday)).toBeNull();
    const saturday = new Date("2026-11-07T20:00:00Z");
    expect(classifyRush("2026-11-09", saturday)).toBeNull();
    expect(classifyRush("2026-11-08", saturday)).toBe("weekend");

    const thursday = new Date("2026-11-05T20:00:00Z");
    const state = blank("C:rush");
    state.channel = "C1";
    state.threadTs = "1.2";
    const outcome = applyAnswers(state, {
      ...completeDraft(),
      requestedCompletionDate: "2026-11-06",
    }, thursday);
    expect(outcome.kind).toBe("rush_required");
    const store = new MemoryStore();
    await store.saveConversation(state);
    const dms: string[] = [];
    await startRushApproval({
      state,
      store,
      date: "2026-11-06",
      reason: "next_day",
      summary: "Alex needs a banner by 2026-11-06.",
      channel: "C1",
      threadTs: "1.2",
      postDm: async (userId) => { dms.push(userId); },
    });
    expect(dms).toEqual(["U0B5F1HN98Q", "U0B6N3RE23T"]);
    const saved = await store.getValue(`intake:rush:${state.draft.rushApprovalId}`);
    expect(saved).toContain("pending");
    state.phase = "awaiting_confirm";
    state.confirmVersion = 1;
    const blocked = await submitConfirmedBrief({
      confirmed: true,
      version: 1,
      state,
      store,
      token: "t",
      fetchImpl: (async () => { throw new Error("should not create"); }) as typeof fetch,
    });
    expect(blocked.text).toContain("needs approval");
    const decision = await applyRushDecision({
      store,
      approvalId: state.draft.rushApprovalId ?? "",
      approverId: "U0B6N3RE23T",
      decision: "approved",
    });
    expect(decision.text).toContain("Rush approved by DeeDee Brown");
    const reloaded = await store.getConversation("C:rush");
    expect(reloaded?.draft.rushApprovedBy).toBe("DeeDee Brown");
    const description = buildDescription({ draft: reloaded!.draft, templateOffer: null });
    expect(description).toContain("Rush approved by DeeDee Brown");
    expect(description.split("## Brief")[1]?.split("Rush approved")[0]).not.toContain("Rush approved");
  });

  it("lets Koral or DeeDee approve a Friday request due Monday, and refuses a Saturday due date", async () => {
    const friday = new Date("2026-11-06T20:00:00Z");
    const state = blank("C:fri-mon");
    const outcome = applyAnswers(state, {
      ...completeDraft(),
      requestedCompletionDate: "2026-11-09",
    }, friday);
    expect(outcome.kind).toBe("rush_required");
    if (outcome.kind === "rush_required") expect(outcome.reason).toBe("friday_monday");
    const store = new MemoryStore();
    await store.saveConversation(state);
    const dms: string[] = [];
    await startRushApproval({
      state,
      store,
      date: "2026-11-09",
      reason: "friday_monday",
      summary: "Alex needs a banner by Monday.",
      channel: "C1",
      threadTs: "1.2",
      postDm: async (userId) => { dms.push(userId); },
    });
    expect(dms).toEqual(["U0B5F1HN98Q", "U0B6N3RE23T"]);
    const decision = await applyRushDecision({
      store,
      approvalId: state.draft.rushApprovalId ?? "",
      approverId: "U0B5F1HN98Q",
      decision: "approved",
    });
    expect(decision.text).toContain("Rush approved by Koral Captain");
    const weekend = blank("C:weekend");
    const blocked = applyAnswers(weekend, {
      ...completeDraft(),
      requestedCompletionDate: "2026-11-07",
    }, friday);
    expect(blocked.kind).toBe("rush_required");
    if (blocked.kind === "rush_required") expect(blocked.reason).toBe("weekend");
    await expect(startRushApproval({
      state: weekend,
      store,
      date: "2026-11-07",
      reason: "weekend",
      summary: "Weekend",
      channel: "C1",
      postDm: async () => undefined,
    })).rejects.toThrow(/cannot be approved/);
  });
});

function completeDraft() {
  return {
    requesterName: "Alex Guest",
    requesterEmail: "alex@example.com",
    requestName: "Banner",
    properties: ["SMP"],
    requestType: "Creative" as const,
    taskType: "Email",
    requestedCompletionDate: "2026-12-01",
    consequenceOfDelay: "The sale is missed.",
    approver: "DeeDee Brown",
    whereItGoesLive: "Email",
    finalCopy: "Join us.",
    assets: ["https://drive.example.com/a"],
    followUps: { "Audience / Distribution Plan": "Members email", "Recommended Copy / Details": "Join us." },
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".ts")) out.push(readFileSync(path, "utf8"));
  }
  return out;
}

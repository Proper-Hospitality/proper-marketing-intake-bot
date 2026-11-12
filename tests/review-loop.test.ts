import { describe, expect, it } from "vitest";
import { listMissing } from "../src/intake/missing.js";
import { configuredReviewer } from "../src/review/config.js";
import { applyReviewReply, parseApproverChoice, readyForReview, type ReviewSession, type ReviewTask } from "../src/review/loop.js";
import { pollReviews } from "../src/review/poll.js";
import { saveReviewParty } from "../src/review/store.js";
import { MemoryStore } from "../src/store/memory.js";

const party = {
  taskGid: "T1",
  taskName: "SMP | New Page | Holiday Offer",
  property: "SMP",
  approverName: "Jamie Mark",
  approverSlackId: "UJAMIE",
};

function session(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    taskGid: "T1",
    taskName: party.taskName,
    property: "SMP",
    link: "https://canva.com/design/abc",
    approverName: "Jamie Mark",
    approverSlackId: "UJAMIE",
    round: 0,
    phase: "awaiting_choice",
    ...overrides,
  };
}

function task(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    gid: "T1",
    name: party.taskName,
    completed: false,
    memberships: [{ section: { name: "Review" } }],
    custom_fields: [{ name: "Final Deliverable Link", display_value: "https://canva.com/design/abc" }],
    ...overrides,
  };
}

describe("requester review in Slack", () => {
  it("asks the requester if they are the approver, and uses Elizabeth for the configured types", () => {
    const page = listMissing({
      requesterName: "Jamie Mark",
      requesterEmail: "jamie@properhotel.com",
      requestName: "Holiday offer",
      properties: ["SMP"],
      requestType: "Web",
      taskType: "New Page",
      requestedCompletionDate: "2026-12-04",
      followUps: {
        URL: "https://www.properhotel.com/santa-monica/offers",
        "Page Headline (Exact)": "Holiday",
        "Page Copy (Exact)": "Come stay.",
        "What it replaces and where it sits": "None, new page",
      },
      copyReady: true,
      designNeeded: false,
    }, new Date("2026-11-12T18:00:00Z"));
    expect(page.items.map((item) => item.id)).toContain("approver");
    expect(parseApproverChoice("me", { id: "UJAMIE", name: "Jamie Mark" })).toEqual({
      name: "Jamie Mark",
      slackId: "UJAMIE",
      source: "requester",
    });
    expect(parseApproverChoice("Alex Guest", { id: "UJAMIE", name: "Jamie Mark" })?.source).toBe("named");

    const menu = listMissing({
      requesterName: "Jamie Mark",
      requesterEmail: "jamie@properhotel.com",
      requestName: "Dinner menu",
      properties: ["SFP"],
      requestType: "Web",
      taskType: "Menu Upload",
      requestedCompletionDate: "2026-12-04",
      followUps: { Details: "Swap the dinner menu." },
      designNeeded: false,
    }, new Date("2026-11-12T18:00:00Z"));
    expect(menu.items.map((item) => item.id)).not.toContain("approver");
    expect(configuredReviewer("Menu Upload")?.name).toBe("Elizabeth Van Bergen");
    expect(configuredReviewer("Menu Upload")?.slackId).toBe("U0CBTQ82WHW");
    expect(configuredReviewer("New Page")).toBeUndefined();
  });

  it("DMs the approver only when the task is in Review and has a link", async () => {
    const store = new MemoryStore();
    await saveReviewParty(store, party);
    const dms: Array<{ userId: string; text: string }> = [];
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      const tasks = [
        task({ gid: "T-no-link", custom_fields: [{ name: "Final Deliverable Link", display_value: "" }] }),
        task({ gid: "T-building", memberships: [{ section: { name: "In progress" } }] }),
        task(),
      ];
      return new Response(JSON.stringify({ data: tasks }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const result = await pollReviews({
      token: "asana",
      store,
      fetchImpl,
      postDm: async (userId, text) => { dms.push({ userId, text }); },
    });
    expect(result.opened).toBe(1);
    expect(dms).toHaveLength(1);
    expect(dms[0]?.userId).toBe("UJAMIE");
    expect(dms[0]?.text).toContain("SMP | New Page | Holiday Offer");
    expect(dms[0]?.text).toContain("https://canva.com/design/abc");
    expect(calls.some((url) => url.includes("/complete"))).toBe(false);
    expect(readyForReview(task({ custom_fields: [] }))).toBeUndefined();
  });

  it("writes feedback as one Asana comment, stops after two rounds, and never marks Done", () => {
    const first = applyReviewReply(session(), "request changes");
    expect(first.kind).toBe("ask");
    const noted = applyReviewReply(first.session, "The headline is too small.");
    expect(noted.kind).toBe("comment");
    if (noted.kind !== "comment") return;
    expect(noted.comment).toContain("Feedback from Jamie Mark via Slack (round 1)");
    expect(noted.comment).toContain("The headline is too small.");
    const secondAsk = applyReviewReply({ ...noted.session, phase: "awaiting_choice" }, "request changes");
    const second = applyReviewReply(secondAsk.session, "Move the photo down.");
    expect(second.kind).toBe("comment");
    if (second.kind !== "comment") return;
    expect(second.session.round).toBe(2);
    const capped = applyReviewReply({ ...second.session, phase: "awaiting_choice" }, "request changes");
    expect(capped.kind).toBe("escalate");
    if (capped.kind !== "escalate") return;
    expect(capped.comment).toContain("Escalated after 2 revision rounds");
    expect(capped.comment).not.toMatch(/DeeDee|Koral/);

    const approved = applyReviewReply(session(), "approve", new Date("2026-11-12T20:00:00Z"));
    expect(approved.kind).toBe("approve");
    if (approved.kind !== "approve") return;
    expect(approved.comment).toContain("Approved by Jamie Mark via Slack");
    expect(approved.comment).toContain("mark this Done");
    expect(approved.comment.toLowerCase()).not.toContain("completed: true");
  });

  it("does not let the person who did the work approve it", async () => {
    const store = new MemoryStore();
    await saveReviewParty(store, { ...party, approverName: "Harwinder Singh", workerName: "Harwinder Singh" });
    const comments: string[] = [];
    const dms: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/stories")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { data?: { text?: string } };
        comments.push(body.data?.text ?? "");
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: [task({ assignee: { name: "Harwinder Singh" } })],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const result = await pollReviews({
      token: "asana",
      store,
      fetchImpl,
      postDm: async (userId) => { dms.push(userId); },
    });
    expect(result.opened).toBe(0);
    expect(dms).toEqual([]);
    expect(comments[0]).toContain("can't approve");
    expect(comments[0]).not.toContain("Done");
  });
});

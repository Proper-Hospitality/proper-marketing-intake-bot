import { describe, expect, it, vi } from "vitest";
import { applyStatusAction, considerStatusUpdate } from "../src/status/listen.js";
import { parseStatusIntent } from "../src/status/intent.js";
import { asanaTaskGids, selectStatusTasks } from "../src/status/match.js";
import { mightBeStatusUpdate, nextRateWindow, STATUS_RATE_LIMIT } from "../src/status/prefilter.js";
import { canConfirmStatus, statusComment, statusProposalBlocks } from "../src/status/blocks.js";
import type { SlackApi } from "../src/slack/api.js";
import { MemoryStore } from "../src/store/memory.js";
import type { ListedTask } from "../src/store/types.js";
import type { FieldMapper } from "../src/canva/map-fields.js";

const MENU: ListedTask = {
  gid: "111",
  name: "SMP menu upload",
  assigneeName: "Elena Ruiz",
  assigneeGid: "A1",
  projectNames: ["New Intake Board"],
  url: "https://app.asana.com/0/1/111",
};
const OTHER: ListedTask = {
  gid: "222",
  name: "SMP menu refresh",
  assigneeName: "Elena Ruiz",
  assigneeGid: "A1",
  projectNames: ["New Creative Queue"],
  url: "https://app.asana.com/0/1/222",
};

describe("Slack status updates", () => {
  it("ignores chit-chat and keeps status wording", () => {
    expect(mightBeStatusUpdate("thanks!")).toBe(false);
    expect(mightBeStatusUpdate("ok")).toBe(false);
    expect(mightBeStatusUpdate("the SMP menu is live")).toBe(true);
    expect(mightBeStatusUpdate("push the due date to 2026-12-01")).toBe(true);
    expect(mightBeStatusUpdate("see https://app.asana.com/0/9/111")).toBe(true);
  });

  it("prefers an Asana link, otherwise ranks by property and assignee", () => {
    expect(asanaTaskGids("done https://app.asana.com/1/5/project/9/task/111")).toEqual(["111"]);
    const linked = selectStatusTasks({
      linked: [MENU],
      searched: [OTHER],
      query: "menu",
      properties: ["SMP"],
      assigneeGid: "A1",
    });
    expect(linked).toEqual({ mode: "one", tasks: [MENU] });
    const ambiguous = selectStatusTasks({
      linked: [],
      searched: [MENU, OTHER],
      query: "menu",
      properties: ["SMP"],
      assigneeGid: "A1",
    });
    expect(ambiguous.mode).toBe("choice");
    expect(ambiguous.tasks).toHaveLength(2);
  });

  it("lets only the speaker or the assignee confirm", () => {
    expect(canConfirmStatus({ clickerId: "U1", speakerId: "U1" })).toBe(true);
    expect(canConfirmStatus({ clickerId: "U2", speakerId: "U1", clickerAsanaGid: "A1", assigneeGid: "A1" })).toBe(true);
    expect(canConfirmStatus({ clickerId: "U2", speakerId: "U1", clickerAsanaGid: "A9", assigneeGid: "A1" })).toBe(false);
    expect(statusComment({
      name: "Elena Ruiz",
      permalink: "https://properhospitalitycorp.slack.com/archives/C0AV038G751/p1",
      change: "Mark complete",
    })).toMatch(/^Updated from Slack by Elena Ruiz\n/);
  });

  it("parses a due-date intent and rejects a date it cannot normalize", () => {
    expect(parseStatusIntent('{"intent":"due","dueOn":"2026-12-01","note":"pushed","query":"menu"}')).toEqual({
      kind: "due",
      dueOn: "2026-12-01",
      note: "pushed",
      query: "menu",
    });
    expect(parseStatusIntent('{"intent":"due","dueOn":"soon","note":"","query":"menu"}')).toEqual({ kind: "none" });
    expect(parseStatusIntent('{"intent":"none"}')).toEqual({ kind: "none" });
  });

  it("stops proposing after the channel rate limit", () => {
    let window = { count: 0, windowStart: 1_000 };
    for (let i = 0; i < STATUS_RATE_LIMIT; i += 1) {
      const next = nextRateWindow({ ...window, now: 1_000 });
      expect(next.allowed).toBe(true);
      window = next;
    }
    expect(nextRateWindow({ ...window, now: 1_000 }).allowed).toBe(false);
  });

  it("proposes once for a channel message and does not change Asana until Confirm", async () => {
    const store = new MemoryStore();
    const posts: Array<{ userId?: string; blocks?: unknown[] }> = [];
    const methods: string[] = [];
    const slack = fakeSlack(posts);
    const llm: FieldMapper = {
      async complete() {
        return { content: [{ type: "text", text: '{"intent":"complete","dueOn":null,"note":"live","query":"menu"}' }] };
      },
    };
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      const href = String(url);
      if (href.includes("/typeahead")) {
        return json({ data: [{ gid: "A1", name: "Elena Ruiz", email: "elena@example.com" }] });
      }
      if (href.includes("/tasks/search")) {
        return json({ data: [{
          gid: "111",
          name: "SMP menu upload",
          permalink_url: MENU.url,
          due_on: null,
          assignee: { gid: "A1", name: "Elena Ruiz" },
          projects: [{ name: "New Intake Board" }],
        }] });
      }
      if ((init?.method ?? "GET") === "PUT") return json({ data: { gid: "111" } });
      if (href.includes("/stories")) return json({ data: { gid: "story" } });
      return json({ data: {} });
    });
    const message = {
      channel: "C0AV038G751",
      userId: "U1",
      text: "the SMP menu is live",
      ts: "1793744775.525019",
      isDm: false,
      files: [],
      uploads: [],
      edited: false,
    };
    const first = await considerStatusUpdate({
      message,
      store,
      slack,
      llm,
      asanaToken: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      channels: new Set(["C0AV038G751"]),
      now: 5_000,
    });
    expect(first).toBe("proposed");
    expect(methods.every((method) => method !== "PUT")).toBe(true);
    expect(posts[0]?.userId).toBe("U1");
    const blocks = JSON.stringify(posts[0]?.blocks);
    expect(blocks).toContain("status_confirm");
    expect(blocks).toContain("status_dismiss");
    expect(blocks).toContain(MENU.url);
    const again = await considerStatusUpdate({
      message,
      store,
      slack,
      llm,
      asanaToken: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      channels: new Set(["C0AV038G751"]),
      now: 6_000,
    });
    expect(again).toBe("skipped");
    expect(posts).toHaveLength(1);

    const quiet = await considerStatusUpdate({
      message: { ...message, ts: "2.2", text: "thanks!" },
      store,
      slack,
      llm: { async complete() { throw new Error("should not ask Claude"); } },
      asanaToken: "token",
      channels: new Set(["C0AV038G751"]),
    });
    expect(quiet).toBe("skipped");

    const outside = await considerStatusUpdate({
      message: { ...message, channel: "COTHER", ts: "3.3" },
      store,
      slack,
      llm: { async complete() { throw new Error("should not ask Claude"); } },
      asanaToken: "token",
      channels: new Set(["C0AV038G751"]),
    });
    expect(outside).toBe("skipped");

    const proposalId = JSON.parse((await store.getValue((await proposalKey(store)) ?? "")) || "{}").id as string;
    const denied = vi.fn();
    await applyStatusAction({
      action: "confirm",
      proposalId,
      clickerId: "U2",
      store,
      slack: { ...slack, userProfile: async () => ({ name: "Someone Else", email: "other@example.com" }) },
      asanaToken: "token",
      responseUrl: "https://hooks.slack.com/actions/1",
      fetchImpl: vi.fn(async () => {
        denied();
        return json({ ok: true });
      }) as unknown as typeof fetch,
    });
    expect(methods.every((method) => method !== "PUT")).toBe(true);

    const responses: unknown[] = [];
    await applyStatusAction({
      action: "confirm",
      proposalId,
      clickerId: "U1",
      store,
      slack,
      asanaToken: "token",
      responseUrl: "https://hooks.slack.com/actions/1",
      fetchImpl: vi.fn(async (url: string | URL, init?: RequestInit) => {
        methods.push(init?.method ?? "GET");
        if (String(url).includes("hooks.slack.com")) responses.push(JSON.parse(String(init?.body)));
        if (String(url).includes("/typeahead")) return json({ data: [{ gid: "A1", name: "Elena Ruiz", email: "elena@example.com" }] });
        if ((init?.method ?? "GET") === "PUT") return json({ data: { gid: "111" } });
        if (String(url).includes("/stories")) {
          expect(JSON.parse(String(init?.body)).data.text).toMatch(/^Updated from Slack by Elena Ruiz/);
          return json({ data: { gid: "story" } });
        }
        return json({ ok: true });
      }) as unknown as typeof fetch,
    });
    expect(methods).toContain("PUT");
    expect(JSON.stringify(responses[0])).toContain("Updated");
  });

  it("puts Confirm, Pick another task, and Dismiss on a single match when alternates exist", () => {
    const blocks = statusProposalBlocks({
      id: "st_1",
      channel: "C0AV038G751",
      threadTs: "1.1",
      messageTs: "1.1",
      speakerId: "U1",
      speakerName: "Elena Ruiz",
      permalink: "https://example.com",
      intent: { kind: "complete", note: "live", query: "menu" },
      tasks: [MENU, OTHER],
      selectedGid: MENU.gid,
      ephemeral: true,
    }, "confirm");
    const actions = blocks.find((block) => block.type === "actions");
    const labels = actions && "elements" in actions
      ? actions.elements.map((element) => "text" in element && element.text && "text" in element.text ? element.text.text : "")
      : [];
    expect(labels).toEqual(["Confirm", "Pick another task", "Dismiss"]);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function fakeSlack(posts: Array<{ userId?: string; blocks?: unknown[] }>): SlackApi {
  return {
    async postMessage(args) {
      posts.push({ blocks: args.blocks });
      return { ts: "9.9" };
    },
    async updateMessage() {},
    async userProfile() { return { name: "Elena Ruiz", email: "elena@example.com" }; },
    async threadReplies() { return []; },
    async postEphemeral(args) {
      posts.push({ userId: args.userId, blocks: args.blocks });
      return { ts: "8.8" };
    },
    async permalink() { return "https://properhospitalitycorp.slack.com/archives/C0AV038G751/p1793744775525019"; },
  };
}

async function proposalKey(store: MemoryStore): Promise<string | undefined> {
  const keys = [...store.values.keys()];
  return keys.find((key) => key.startsWith("status:proposal:"));
}

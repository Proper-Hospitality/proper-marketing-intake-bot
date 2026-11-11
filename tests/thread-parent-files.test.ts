import { describe, expect, it, vi } from "vitest";
import { uploadLoadedAttachments } from "../src/intake/task-files.js";
import { handleConfirmAction, handleIncomingMessage } from "../src/slack/handle.js";
import type { SlackApi } from "../src/slack/api.js";
import { collectThreadFiles, filesFromThread } from "../src/slack/thread-files.js";
import { MemoryStore } from "../src/store/memory.js";
import { emptyConversation } from "../src/store/types.js";
import type { Llm } from "../src/agent/run.js";
import type { BriefDraft } from "../src/intake/types.js";

const CHANNEL = "C0AV038G751";
const PARENT = "1794411410.947679";
const REPLY = "1794412000.100000";
const LATER = "1794413000.100000";
const FILE_ID = "F0CGUP9LUNN";

describe("files on the thread parent", () => {
  it("keeps the parent file and earlier replies, once each, and skips later ones", () => {
    const files = filesFromThread([
      {
        ts: PARENT,
        files: [{ id: FILE_ID, name: "image.png", permalink: "https://slack.example/image.png", mimetype: "image/png" }],
      },
      { ts: REPLY, files: [{ id: FILE_ID, name: "image.png" }, { id: "F-REPLY", name: "notes.pdf" }] },
      { ts: LATER, files: [{ id: "F-LATER", name: "after.png" }] },
    ], REPLY);
    expect(files.map((file) => file.slackFileId)).toEqual([FILE_ID, "F-REPLY"]);
    expect(files[0]).toMatchObject({ name: "image.png", permalink: "https://slack.example/image.png" });
  });

  it("reads the parent from history when replies omit its files", async () => {
    const history = vi.fn(async () => ({
      ts: PARENT,
      text: "create a creative task",
      files: [{ id: FILE_ID, name: "image.png" }],
    }));
    const files = await collectThreadFiles({
      threadReplies: async () => [{ ts: PARENT, text: "create a creative task" }, { ts: REPLY, text: "any update?" }],
      historyMessage: history,
    }, CHANNEL, PARENT, REPLY);
    expect(history).toHaveBeenCalledWith(CHANNEL, PARENT);
    expect(files.map((file) => file.slackFileId)).toEqual([FILE_ID]);
  });

  it("saves a parent file at creation time when the opening event has no files", async () => {
    const store = new MemoryStore();
    const posts: string[] = [];
    await handleIncomingMessage({
      store,
      slack: slack({
        posts,
        replies: [{
          ts: PARENT,
          user: "U1",
          text: "create a creative task for a digital ad",
          files: [{ id: FILE_ID, name: "image.png", mimetype: "image/png", permalink: "https://slack.example/image.png" }],
        }],
      }),
      llm: { async complete() { return { content: [{ type: "text", text: "What is this for?" }] }; } },
    }, {
      channel: CHANNEL,
      userId: "U1",
      text: "create a creative task for a digital ad",
      ts: PARENT,
      isDm: false,
      uploads: [],
    });
    const state = await store.getConversation(`${CHANNEL}:${PARENT}`);
    expect(state?.draft.attachments?.map((file) => file.slackFileId)).toEqual([FILE_ID]);
    expect(posts.join("\n")).not.toMatch(/can'?t open attachments|don't have a file/i);
  });

  it("uploads the parent file onto an already-filed task when the reply itself has none", async () => {
    const store = new MemoryStore();
    const state = emptyConversation(`${CHANNEL}:${PARENT}`);
    state.phase = "submitted";
    state.taskGid = "1220424233849324";
    state.taskUrl = "https://app.asana.com/0/1/1220424233849324";
    state.channel = CHANNEL;
    state.threadTs = PARENT;
    state.draft = { requestName: "Basel Digital Signage Ad", properties: ["SMB"] };
    await store.saveConversation(state);
    const calls: string[] = [];
    const posts: string[] = [];
    await handleIncomingMessage({
      store,
      slack: slack({
        posts,
        replies: [
          { ts: PARENT, user: "U1", text: "include the attachment", files: [{ id: FILE_ID, name: "image.png", permalink: "https://slack.example/image.png" }] },
          { ts: REPLY, user: "U1", text: "did the file land?" },
        ],
      }),
      llm: failIfCalled(),
      asanaToken: "asana",
      slackToken: "xoxb-test",
      fetchImpl: fetchMock(calls) as unknown as typeof fetch,
    }, {
      channel: CHANNEL,
      userId: "U1",
      text: "did the file land? the attachment is missing",
      ts: REPLY,
      threadTs: PARENT,
      isDm: false,
      uploads: [],
    });
    const saved = await store.getConversation(`${CHANNEL}:${PARENT}`);
    expect(saved?.draft.attachments?.map((file) => file.slackFileId)).toEqual([FILE_ID]);
    expect(saved?.uploadedSlackFileIds).toEqual([FILE_ID]);
    expect(calls.some((call) => call === "POST https://app.asana.com/api/1.0/tasks/1220424233849324/attachments")).toBe(true);
    expect(posts.join("\n")).toContain("image.png");
    expect(posts.join("\n")).not.toContain("I don't have a file from this thread");
    expect(posts.join("\n")).toContain("https://app.asana.com/0/1/1220424233849324");

    calls.length = 0;
    await handleIncomingMessage({
      store,
      slack: slack({ posts, replies: [{ ts: PARENT, files: [{ id: FILE_ID, name: "image.png" }] }] }),
      llm: failIfCalled(),
      asanaToken: "asana",
      slackToken: "xoxb-test",
      fetchImpl: fetchMock(calls) as unknown as typeof fetch,
    }, {
      channel: CHANNEL,
      userId: "U1",
      text: "checking again",
      ts: "1794412100.100000",
      threadTs: PARENT,
      isDm: false,
      uploads: [],
    });
    expect(calls.some((call) => call.includes("files.info") || call.includes("/attachments"))).toBe(false);
  });

  it("does not upload a second copy when Asana already has that file name", async () => {
    const calls: string[] = [];
    const uploaded = await uploadLoadedAttachments({
      taskGid: "1220424233849324",
      asanaToken: "asana",
      files: [{
        slackFileId: FILE_ID,
        name: "image.png",
        bytes: Uint8Array.from([1]),
        mimetype: "image/png",
      }],
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push(`${method} ${String(url)}`);
        if (method === "GET") return json({ data: [{ gid: "ATT", name: "image.png" }] });
        return json({ data: { gid: "ATT2" } });
      }) as unknown as typeof fetch,
    });
    expect(uploaded).toEqual([FILE_ID]);
    expect(calls.some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("files the parent file when Confirm runs and the event never carried it", async () => {
    const store = new MemoryStore();
    const state = emptyConversation(`${CHANNEL}:${PARENT}`);
    state.phase = "awaiting_confirm";
    state.confirmVersion = 1;
    state.channel = CHANNEL;
    state.threadTs = PARENT;
    state.draft = readyDraft();
    await store.saveConversation(state);
    const calls: string[] = [];
    await handleConfirmAction({
      store,
      slack: slack({
        posts: [],
        replies: [{ ts: PARENT, text: "ad request", files: [{ id: FILE_ID, name: "image.png", permalink: "https://slack.example/image.png" }] }],
      }),
      asanaToken: "asana",
      slackToken: "xoxb-test",
      fetchImpl: fetchMock(calls, true) as unknown as typeof fetch,
    }, {
      version: 1,
      channel: CHANNEL,
      messageTs: "1794411500.000001",
      threadTs: PARENT,
    });
    const saved = await store.getConversation(`${CHANNEL}:${PARENT}`);
    expect(saved?.phase).toBe("submitted");
    expect(saved?.uploadedSlackFileIds).toEqual([FILE_ID]);
    expect(calls.some((call) => call.includes("/attachments") && call.startsWith("POST"))).toBe(true);
    const created = calls.find((call) => call.startsWith("POST https://app.asana.com/api/1.0/tasks"));
    expect(created).toBeTruthy();
  });
});

function readyDraft(): BriefDraft {
  return {
    requesterName: "Kinsey East",
    requesterEmail: "kinsey@example.com",
    requestName: "Basel Digital Signage Ad",
    properties: ["SMB"],
    requestType: "Creative",
    taskType: "Ad",
    requestedCompletionDate: "2026-12-01",
    consequenceOfDelay: "We miss the placement.",
    approver: "DeeDee Brown",
    whereItGoesLive: "Digital signage",
    assets: ["https://drive.example.com/ref"],
    followUps: {
      "Audience / Distribution Plan": "SMB guests",
      "Recommended Copy / Details": "Basel digital ad",
      "Asset Size": "85 inch, 9x16, vertical",
    },
  };
}

function slack(input: {
  posts: string[];
  replies: Array<{ ts?: string; user?: string; text?: string; files?: Array<{ id: string; name?: string; permalink?: string; mimetype?: string }> }>;
}): SlackApi {
  return {
    async postMessage(args) {
      input.posts.push(args.text);
      return { ts: "posted" };
    },
    async updateMessage() {},
    async userProfile() {
      return { name: "Kinsey East", email: "kinsey@example.com" };
    },
    async threadReplies() {
      return input.replies.map((reply) => ({
        ts: reply.ts,
        user: reply.user,
        text: reply.text ?? "",
        files: reply.files,
      }));
    },
  };
}

function failIfCalled(): Llm {
  return { async complete() { throw new Error("should not ask the model"); } };
}

function fetchMock(calls: string[], filing = false): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const href = String(url);
    calls.push(`${method} ${href}`);
    if (href.includes("files.info")) {
      return json({
        ok: true,
        file: { name: "image.png", mimetype: "image/png", permalink: "https://slack.example/image.png", url_private: "https://files.slack.com/image.png" },
      });
    }
    if (href.includes("files.slack.com")) return new Response(Uint8Array.from([9, 9]));
    if (method === "GET" && href.includes("/attachments")) return json({ data: [] });
    if (method === "POST" && href.includes("/attachments")) return json({ data: { gid: "ATT1" } });
    if (!filing) return json({ data: [] });
    if (method === "POST") return json({ data: { gid: "1220424233849324" } });
    if (method === "PUT") return json({ data: { gid: "1220424233849324" } });
    return json({
      data: {
        gid: "1220424233849324",
        permalink_url: "https://app.asana.com/0/1/1220424233849324",
        memberships: [
          { project: { gid: "1217171684008018", name: "New Intake Board" }, section: { name: "New requests - Submitted via Form" } },
        ],
        custom_fields: [
          { name: "Request Type_New Intake Board", display_value: "Creative" },
          { name: "Creative Task Type", display_value: "Ad" },
          { name: "Property List_New Intake Board", display_value: "SMB" },
          { name: "Status in Que", display_value: "New Request" },
          { name: "Estimated time", display_value: "2h" },
        ],
      },
    });
  }) as unknown as typeof fetch;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

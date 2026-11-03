import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { handleIncomingMessage } from "../src/slack/handle.js";
import { dispatchUserMessage } from "../src/slack/dispatch.js";
import { HANDLER_FAILURE_TEXT } from "../src/slack/failure.js";
import {
  REQUIRED_BOT_EVENTS,
  messageClaimKey,
  normalizeSlackMessage,
  shouldHandleThreadReply,
} from "../src/slack/incoming.js";
import { downloadSlackFile } from "../src/slack/files.js";
import type { SlackApi } from "../src/slack/api.js";
import { MemoryStore } from "../src/store/memory.js";
import { emptyConversation } from "../src/store/types.js";
import type { Llm } from "../src/agent/run.js";

const THREAD = "1793744566.137629";

describe("channel thread replies during Canva build", () => {
  it("keeps a file_share reply in the build thread, including the uploaded image", () => {
    const message = normalizeSlackMessage({
      type: "message",
      subtype: "file_share",
      channel: "C0CEMM9G9EW",
      channel_type: "channel",
      user: "U0AV97G7UE8",
      text: "here's the copy and the photo: SMP winter entertainment promo",
      ts: "1793744775.525019",
      thread_ts: THREAD,
      files: [{ id: "F0CEPQ96LJD", name: "Screenshot.png", mimetype: "image/png" } as { id: string; name: string }],
    });
    expect(message).toMatchObject({
      channel: "C0CEMM9G9EW",
      isDm: false,
      threadTs: THREAD,
      text: "here's the copy and the photo: SMP winter entertainment promo",
      edited: false,
    });
    expect(message?.uploads).toEqual([{ source: "slack", slackFileId: "F0CEPQ96LJD", name: "Screenshot.png" }]);
    expect(shouldHandleThreadReply({ isDm: false, threadTs: THREAD, hasConversation: true })).toBe(true);
    expect(shouldHandleThreadReply({ isDm: false, threadTs: THREAD, hasConversation: false })).toBe(false);
    expect(shouldHandleThreadReply({ isDm: true, hasConversation: false })).toBe(true);
  });

  it("unwraps a message_changed edit and dedupes it against the same files", () => {
    const edited = normalizeSlackMessage({
      type: "message",
      subtype: "message_changed",
      channel: "C0CEMM9G9EW",
      channel_type: "channel",
      ts: "1793744780.000001",
      message: {
        user: "U0AV97G7UE8",
        text: "2.",
        ts: "1793744709.104469",
        thread_ts: THREAD,
        files: [{ id: "F0CERJE1F1S", name: "photo.png" }],
      },
    });
    expect(edited).toMatchObject({ edited: true, ts: "1793744709.104469", threadTs: THREAD, text: "2." });
    expect(edited?.uploads.map((file) => file.slackFileId)).toEqual(["F0CERJE1F1S"]);
    const original = normalizeSlackMessage({
      type: "message",
      subtype: "file_share",
      channel: "C0CEMM9G9EW",
      channel_type: "channel",
      user: "U0AV97G7UE8",
      text: "2.",
      ts: "1793744709.104469",
      thread_ts: THREAD,
      files: [{ id: "F0CERJE1F1S", name: "photo.png" }],
    });
    expect(messageClaimKey(edited!)).toBe(messageClaimKey(original!));
    const changed = { ...edited!, text: "2. use this newer crop" };
    expect(messageClaimKey(changed)).not.toBe(messageClaimKey(original!));
    expect(normalizeSlackMessage({
      type: "message",
      subtype: "message_changed",
      channel: "C0CEMM9G9EW",
      message: { bot_id: "B1", user: "UBOT", text: "hello", ts: "1.2" },
    })).toBeNull();
  });

  it("handles a thread file upload when the conversation exists and posts an error if handling throws", async () => {
    const store = new MemoryStore();
    const state = emptyConversation(`C0CEMM9G9EW:${THREAD}`);
    state.phase = "awaiting_design_materials";
    await store.saveConversation(state);
    const seen: string[] = [];
    const handled = await dispatchUserMessage({
      event: {
        type: "message",
        subtype: "file_share",
        channel: "C0CEMM9G9EW",
        channel_type: "channel",
        user: "U0AV97G7UE8",
        text: "SMP winter entertainment promo. up to 20% off",
        ts: "1793744775.525019",
        thread_ts: THREAD,
        files: [{ id: "F0CEPQ96LJD", name: "photo.png" }],
      },
      store,
      onMessage: async (message) => {
        seen.push(`${message.text}:${message.uploads[0]?.slackFileId}`);
      },
      postError: async () => {
        throw new Error("should not post");
      },
    });
    expect(handled).toBe("handled");
    expect(seen).toEqual(["SMP winter entertainment promo. up to 20% off:F0CEPQ96LJD"]);

    const ignored = await dispatchUserMessage({
      event: {
        type: "message",
        subtype: "file_share",
        channel: "C0CEMM9G9EW",
        channel_type: "channel",
        user: "U0AV97G7UE8",
        text: "unrelated photo",
        ts: "1793744999.000001",
        thread_ts: "1793744999.000001",
        files: [{ id: "FOTHER", name: "other.png" }],
      },
      store,
      onMessage: async () => {
        throw new Error("unrelated thread");
      },
      postError: async () => {
        throw new Error("should not post");
      },
    });
    expect(ignored).toBe("ignored");

    const errors: string[] = [];
    const failed = await dispatchUserMessage({
      event: {
        type: "message",
        channel: "C0CEMM9G9EW",
        channel_type: "channel",
        user: "U0AV97G7UE8",
        text: "1. SMP winter entertainment promo. up to 20% off",
        ts: "1793744612.798029",
        thread_ts: THREAD,
      },
      store,
      onMessage: async () => {
        throw new Error("canva down");
      },
      postError: async (_channel, threadTs, text) => {
        errors.push(`${threadTs}:${text}`);
      },
    });
    expect(failed).toBe("handled");
    expect(errors).toEqual([`${THREAD}:${HANDLER_FAILURE_TEXT}`]);
  });

  it("processes an edited thread reply once, then again when the photo arrives", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const slack = fakeSlack();
    const llm: Llm = { async complete() { calls.push("llm"); return { content: [{ type: "text", text: "ok" }] }; } };
    const base = {
      store,
      slack,
      llm,
      design: {
        canva: { connected: async () => false, build: async () => ({ kind: "fallback" as const, reason: "not connected" }) },
        download: async () => ({ name: "photo.png", bytes: Uint8Array.from([1]) }),
      },
    };
    await handleIncomingMessage(base, {
      channel: "C1",
      userId: "U1",
      text: "2.",
      ts: "1793744709.104469",
      threadTs: THREAD,
      isDm: false,
      uploads: [],
    });
    await handleIncomingMessage(base, {
      channel: "C1",
      userId: "U1",
      text: "2.",
      ts: "1793744709.104469",
      threadTs: THREAD,
      isDm: false,
      uploads: [],
    });
    await handleIncomingMessage(base, {
      channel: "C1",
      userId: "U1",
      text: "2.",
      ts: "1793744709.104469",
      threadTs: THREAD,
      isDm: false,
      uploads: [{ source: "slack", slackFileId: "F0CERJE1F1S", name: "photo.png" }],
    });
    expect(calls).toHaveLength(2);
  });

  it("downloads url_private with the bot token and documents the channel events", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const authorization = new Headers(init?.headers).get("authorization");
      expect(authorization).toBe("Bearer xoxb-test");
      if (href.includes("files.info")) {
        return new Response(JSON.stringify({
          ok: true,
          file: { name: "photo.png", url_private: "https://files.slack.com/files-pri/T/photo.png" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      expect(href).toBe("https://files.slack.com/files-pri/T/photo.png");
      return new Response(Uint8Array.from([4, 5]), { status: 200 });
    });
    const file = await downloadSlackFile({
      token: "xoxb-test",
      fileId: "F0CERJE1F1S",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(Array.from(file.bytes)).toEqual([4, 5]);

    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
      oauth_config: { scopes: { bot: string[] } };
    };
    for (const eventName of REQUIRED_BOT_EVENTS) expect(readme).toContain(eventName);
    expect(manifest.oauth_config.scopes.bot).toContain("files:read");
    expect(readme).toContain("url_private");
    expect(readme).toContain("files:read");
  });
});

function fakeSlack(): SlackApi {
  return {
    async postMessage() { return { ts: "1" }; },
    async updateMessage() {},
    async userProfile() { return { name: "Elena Ruiz", email: "elena@example.com" }; },
    async threadReplies() { return []; },
  };
}

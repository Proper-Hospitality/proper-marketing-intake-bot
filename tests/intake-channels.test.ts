import { describe, expect, it } from "vitest";
import { dispatchUserMessage } from "../src/slack/dispatch.js";
import { handleIncomingMessage } from "../src/slack/handle.js";
import {
  intakeChannelIds,
  normalizeSlackMessage,
  shouldHandleIncoming,
} from "../src/slack/incoming.js";
import { considerStatusUpdate } from "../src/status/listen.js";
import type { SlackApi } from "../src/slack/api.js";
import { MemoryStore } from "../src/store/memory.js";
import type { Llm } from "../src/agent/run.js";

const CHANNEL = "CINTAKE";

describe("dedicated intake channels", () => {
  it("parses a comma-separated channel list", () => {
    expect([...intakeChannelIds(" C1, C2  C3 ")]).toEqual(["C1", "C2", "C3"]);
    expect(intakeChannelIds("").size).toBe(0);
  });

  it("starts intake on a top-level human message and ignores bots, edits, and joins", () => {
    expect(normalizeSlackMessage({
      type: "message",
      subtype: "channel_join",
      channel: CHANNEL,
      channel_type: "channel",
      user: "U1",
      text: "joined",
      ts: "1.1",
    })).toBeNull();
    expect(normalizeSlackMessage({
      type: "message",
      subtype: "channel_leave",
      channel: CHANNEL,
      user: "U1",
      text: "left",
      ts: "1.2",
    })).toBeNull();
    expect(normalizeSlackMessage({
      type: "message",
      channel: CHANNEL,
      channel_type: "channel",
      bot_id: "B1",
      user: "UBOT",
      text: "I can build this",
      ts: "1.3",
    })).toBeNull();
    expect(shouldHandleIncoming({
      isDm: false,
      mentioned: false,
      messageTs: "2.2",
      hasConversation: false,
      intakeChannel: true,
      edited: false,
    })).toBe(true);
    expect(shouldHandleIncoming({
      isDm: false,
      mentioned: false,
      messageTs: "2.2",
      hasConversation: false,
      intakeChannel: true,
      edited: true,
    })).toBe(false);
    expect(shouldHandleIncoming({
      isDm: false,
      mentioned: false,
      threadTs: "9.9",
      messageTs: "3.3",
      hasConversation: false,
      intakeChannel: true,
      edited: false,
    })).toBe(false);
    expect(shouldHandleIncoming({
      isDm: false,
      mentioned: false,
      threadTs: "2.2",
      messageTs: "3.3",
      hasConversation: true,
      intakeChannel: true,
      edited: false,
    })).toBe(true);
  });

  it("handles a top-level intake-channel message like a mention, and only once", async () => {
    const previous = process.env.SLACK_INTAKE_CHANNELS;
    process.env.SLACK_INTAKE_CHANNELS = CHANNEL;
    try {
      const store = new MemoryStore();
      const seen: string[] = [];
      const event = {
        type: "message",
        channel: CHANNEL,
        channel_type: "channel",
        user: "U1",
        text: "Can you help me get a holiday email designed?",
        ts: "10.10",
      };
      const handled = await dispatchUserMessage({
        event,
        store,
        onMessage: async (message) => {
          seen.push(message.text);
        },
        postError: async () => {
          throw new Error("should not fail");
        },
      });
      expect(handled).toBe("handled");
      expect(seen).toEqual(["Can you help me get a holiday email designed?"]);
      const other = await dispatchUserMessage({
        event: { ...event, channel: "COTHER" },
        store,
        onMessage: async () => {
          throw new Error("not an intake channel");
        },
        postError: async () => undefined,
      });
      expect(other).toBe("ignored");

      const calls: string[] = [];
      const slack = quietSlack();
      const llm: Llm = { async complete() { calls.push("llm"); return { content: [{ type: "text", text: "ok" }] }; } };
      await handleIncomingMessage({ store, slack, llm }, {
        channel: CHANNEL,
        userId: "U1",
        text: "Can you help me get a holiday email designed?",
        ts: "10.10",
        isDm: false,
      });
      await handleIncomingMessage({ store, slack, llm }, {
        channel: CHANNEL,
        userId: "U1",
        text: "<@UBOT> Can you help me get a holiday email designed?",
        ts: "10.10",
        isDm: false,
      });
      expect(calls).toHaveLength(1);
      const saved = await store.getConversation(`${CHANNEL}:10.10`);
      expect(saved?.channel).toBe(CHANNEL);
    } finally {
      if (previous === undefined) delete process.env.SLACK_INTAKE_CHANNELS;
      else process.env.SLACK_INTAKE_CHANNELS = previous;
    }
  });

  it("does not propose an Asana status change for an ordinary intake post", async () => {
    const previous = process.env.SLACK_INTAKE_CHANNELS;
    process.env.SLACK_INTAKE_CHANNELS = CHANNEL;
    try {
      const store = new MemoryStore();
      const ordinary = await considerStatusUpdate({
        message: {
          channel: CHANNEL,
          userId: "U1",
          text: "Can you help me get a holiday email designed for Santa Monica?",
          ts: "11.11",
          isDm: false,
          files: [],
          uploads: [],
          edited: false,
        },
        store,
        slack: quietSlack(),
        llm: { async complete() { throw new Error("ordinary intake must not call Claude for status"); } },
        asanaToken: "token",
        channels: new Set([CHANNEL]),
      });
      expect(ordinary).toBe("skipped");
    } finally {
      if (previous === undefined) delete process.env.SLACK_INTAKE_CHANNELS;
      else process.env.SLACK_INTAKE_CHANNELS = previous;
    }
  });

  it("still proposes a status update when the intake-channel message is clearly one", async () => {
    const previous = process.env.SLACK_INTAKE_CHANNELS;
    process.env.SLACK_INTAKE_CHANNELS = CHANNEL;
    try {
      const store = new MemoryStore();
      let asked = false;
      const result = await considerStatusUpdate({
        message: {
          channel: CHANNEL,
          userId: "U1",
          text: "the SMP menu is live",
          ts: "12.12",
          isDm: false,
          files: [],
          uploads: [],
          edited: false,
        },
        store,
        slack: quietSlack(),
        llm: {
          async complete() {
            asked = true;
            return { content: [{ type: "text", text: "{\"intent\":\"none\"}" }] };
          },
        },
        asanaToken: "token",
        channels: new Set([CHANNEL]),
        now: 1_000,
      });
      expect(asked).toBe(true);
      expect(result).toBe("skipped");
    } finally {
      if (previous === undefined) delete process.env.SLACK_INTAKE_CHANNELS;
      else process.env.SLACK_INTAKE_CHANNELS = previous;
    }
  });
});

function quietSlack(): SlackApi {
  return {
    async postMessage() { return { ts: "1" }; },
    async updateMessage() {},
    async userProfile() { return { name: "Elena Ruiz", email: "elena@example.com" }; },
    async threadReplies() { return []; },
  };
}

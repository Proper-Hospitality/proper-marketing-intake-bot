import { App, type Receiver } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { createAnthropicLlm } from "../agent/anthropic.js";
import { slackFromWebClient } from "../slack/api.js";
import { handleConfirmAction, handleIncomingMessage, handleReviseAction } from "../slack/handle.js";
import { getStore } from "../store/index.js";

class PassiveReceiver implements Receiver {
  init(): void {}
  start(): Promise<unknown> {
    return Promise.resolve();
  }
  stop(): Promise<unknown> {
    return Promise.resolve();
  }
}

let app: App | undefined;

export function getBoltApp(): App {
  if (app) return app;
  const token = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!token || !signingSecret) {
    throw new Error("SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET must be set.");
  }
  app = new App({
    token,
    signingSecret,
    receiver: new PassiveReceiver(),
    processBeforeResponse: true,
    tokenVerificationEnabled: false,
    convoStore: false,
    socketMode: false,
  });
  registerListeners(app);
  return app;
}

function registerListeners(bolt: App): void {
  bolt.event("app_mention", async ({ event, client }) => {
    if (event.bot_id || !event.user) return;
    const text = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
    const userId = event.user;
    await safeHandle(client, event.channel, event.thread_ts, () =>
      handleIncomingMessage(runtime(client), {
        channel: event.channel,
        userId,
        text,
        ts: event.ts,
        threadTs: event.thread_ts,
        isDm: "channel_type" in event && event.channel_type === "im",
        files: linksFrom(event),
      }),
    );
  });

  bolt.message(async ({ message, client }) => {
    if (message.channel_type !== "im") return;
    if (message.subtype && message.subtype !== "file_share") return;
    if (!("user" in message) || !message.user) return;
    const text = "text" in message ? (message.text ?? "") : "";
    const threadTs = "thread_ts" in message ? message.thread_ts : undefined;
    await safeHandle(client, message.channel, threadTs, () =>
      handleIncomingMessage(runtime(client), {
        channel: message.channel,
        userId: message.user,
        text,
        ts: message.ts,
        threadTs,
        isDm: true,
        files: linksFrom(message),
      }),
    );
  });

  bolt.action("confirm_intake", async ({ ack, body, client }) => {
    await ack();
    const action = readAction(body);
    if (!action) return;
    await safeHandle(client, action.channel, action.threadTs, () => handleConfirmAction(runtime(client), action));
  });

  bolt.action("revise_intake", async ({ ack, body, client }) => {
    await ack();
    const action = readAction(body);
    if (!action) return;
    await safeHandle(client, action.channel, action.threadTs, () => handleReviseAction(runtime(client), action));
  });
}

function runtime(client: WebClient) {
  return {
    store: getStore(),
    slack: slackFromWebClient(client),
    llm: createAnthropicLlm(),
    asanaToken: process.env.ASANA_ACCESS_TOKEN,
  };
}

async function safeHandle(client: WebClient, channel: string, threadTs: string | undefined, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(JSON.stringify({ msg: "intake_handler_failed", error: error instanceof Error ? error.message : "unknown" }));
    try {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "Something went wrong on my side, and I didn't file anything. Please try once more. If it keeps failing, use the intake form.",
      });
    } catch (postError) {
      console.error(JSON.stringify({
        msg: "slack_error_reply_failed",
        error: postError instanceof Error ? postError.message : "unknown",
      }));
    }
  }
}

function linksFrom(source: { files?: Array<{ permalink?: string; url_private?: string }> }): string[] {
  return (source.files ?? []).map((file) => file.permalink || file.url_private || "").filter(Boolean);
}

function readAction(body: unknown): { version: number; channel: string; messageTs: string; threadTs?: string } | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as {
    channel?: { id?: string };
    message?: { ts?: string; thread_ts?: string };
    actions?: Array<{ value?: string }>;
  };
  const channel = record.channel?.id;
  const messageTs = record.message?.ts;
  const version = Number(record.actions?.[0]?.value);
  if (!channel || !messageTs || !Number.isFinite(version)) return undefined;
  return { version, channel, messageTs, threadTs: record.message?.thread_ts };
}

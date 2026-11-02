import { App, ExpressReceiver, LogLevel } from "@slack/bolt";
import type { Application } from "express";
import type { WebClient } from "@slack/web-api";
import { createAnthropicLlm } from "../agent/anthropic.js";
import { slackFromWebClient } from "../slack/api.js";
import { withDelivery, type DeliveryContext } from "../slack/dedupe.js";
import { handleConfirmAction, handleIncomingMessage, handleReviseAction } from "../slack/handle.js";
import { getStore } from "../store/index.js";

/** Slack Events and Interactivity both post here. */
export const SLACK_EVENTS_PATH = "/slack/events";
export const HEALTH_PATH = "/health";

/**
 * false means Bolt writes the HTTP 200 as soon as ack() runs, then the listener
 * keeps going in this process. Events are acked before the listener. Button
 * handlers ack first, then do the slow work.
 */
export const PROCESS_BEFORE_RESPONSE = false;

let boltApp: App | undefined;
let expressApp: Application | undefined;

export function createBoltApp(): { bolt: App; expressApp: Application } {
  if (boltApp && expressApp) return { bolt: boltApp, expressApp };
  const token = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!token || !signingSecret) {
    throw new Error("SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET must be set.");
  }

  const receiver = new ExpressReceiver({
    signingSecret,
    endpoints: SLACK_EVENTS_PATH,
    processBeforeResponse: PROCESS_BEFORE_RESPONSE,
  });
  receiver.app.get(HEALTH_PATH, (_req, res) => {
    res.status(200).type("text/plain").send("ok");
  });

  const bolt = new App({
    token,
    receiver,
    processBeforeResponse: PROCESS_BEFORE_RESPONSE,
    tokenVerificationEnabled: false,
    convoStore: false,
    socketMode: false,
    logLevel: LogLevel.INFO,
  });
  registerListeners(bolt);
  boltApp = bolt;
  expressApp = receiver.app;
  return { bolt, expressApp: receiver.app };
}

export async function start(): Promise<void> {
  assertProductionEnv();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("PORT must be a positive number. Render sets PORT for you.");
  }
  const { bolt } = createBoltApp();
  await bolt.start({ port, host: "0.0.0.0" });
  console.log(JSON.stringify({ msg: "listening", port, host: "0.0.0.0", slackPath: SLACK_EVENTS_PATH, healthPath: HEALTH_PATH }));
}

function assertProductionEnv(): void {
  if (!process.env.RENDER) return;
  const required = [
    "SLACK_BOT_TOKEN",
    "SLACK_SIGNING_SECRET",
    "ANTHROPIC_API_KEY",
    "ASANA_ACCESS_TOKEN",
    "REDIS_URL",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing environment variables: ${missing.join(", ")}. Add the Slack, Anthropic, and Asana values on the Render service and save. REDIS_URL comes from the Key Value service in the blueprint; do not type it yourself.`,
    );
  }
  getStore();
}

function registerListeners(bolt: App): void {
  bolt.event("app_mention", async ({ event, client, body, context }) => {
    if (event.bot_id || !event.user) return;
    const text = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
    const userId = event.user;
    await withDelivery({
      body,
      store: getStore(),
      context: deliveryContext(context),
      work: () => safeHandle(client, event.channel, event.thread_ts, () =>
        handleIncomingMessage(runtime(client), {
          channel: event.channel,
          userId,
          text,
          ts: event.ts,
          threadTs: event.thread_ts,
          isDm: "channel_type" in event && event.channel_type === "im",
          files: linksFrom(event),
        })),
    });
  });

  bolt.message(async ({ message, client, body, context }) => {
    if (message.channel_type !== "im") return;
    if (message.subtype && message.subtype !== "file_share") return;
    if (!("user" in message) || !message.user) return;
    const text = "text" in message ? (message.text ?? "") : "";
    const threadTs = "thread_ts" in message ? message.thread_ts : undefined;
    const userId = message.user;
    await withDelivery({
      body,
      store: getStore(),
      context: deliveryContext(context),
      work: () => safeHandle(client, message.channel, threadTs, () =>
        handleIncomingMessage(runtime(client), {
          channel: message.channel,
          userId,
          text,
          ts: message.ts,
          threadTs,
          isDm: true,
          files: linksFrom(message),
        })),
    });
  });

  bolt.action("confirm_intake", async ({ ack, body, client, context }) => {
    await ack();
    const action = readAction(body);
    if (!action) return;
    await withDelivery({
      body,
      store: getStore(),
      context: deliveryContext(context),
      work: () => safeHandle(client, action.channel, action.threadTs, () => handleConfirmAction(runtime(client), action)),
    });
  });

  bolt.action("revise_intake", async ({ ack, body, client, context }) => {
    await ack();
    const action = readAction(body);
    if (!action) return;
    await withDelivery({
      body,
      store: getStore(),
      context: deliveryContext(context),
      work: () => safeHandle(client, action.channel, action.threadTs, () => handleReviseAction(runtime(client), action)),
    });
  });
}

function deliveryContext(context: { retryNum?: number; retryReason?: string }): DeliveryContext {
  return { retryNum: context.retryNum, retryReason: context.retryReason };
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
      throw error;
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

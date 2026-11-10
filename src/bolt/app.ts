import { App, ExpressReceiver, LogLevel } from "@slack/bolt";
import type { Application } from "express";
import type { WebClient } from "@slack/web-api";
import { createAnthropicLlm } from "../agent/anthropic.js";
import { createCanvaDesignClient } from "../canva/turn.js";
import { registerCanvaRoutes } from "../canva/routes.js";
import { slackFromWebClient } from "../slack/api.js";
import { downloadRemoteFile, downloadSlackFile } from "../slack/files.js";
import { withDelivery, type DeliveryContext } from "../slack/dedupe.js";
import { handleCancelTaskCompletion, handleConfirmAction, handleConfirmTaskCompletion, handleIncomingMessage, handleReviseAction } from "../slack/handle.js";
import { dispatchUserMessage } from "../slack/dispatch.js";
import { HANDLER_FAILURE_TEXT } from "../slack/failure.js";
import { normalizeSlackMessage } from "../slack/incoming.js";
import { applyStatusAction, considerStatusUpdate, readStatusClick } from "../status/listen.js";
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
  registerCanvaRoutes(receiver.app, getStore());

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
    await withDelivery({
      body,
      store: getStore(),
      context: deliveryContext(context),
      work: async () => {
        await dispatchUserMessage({
          event: { ...event, type: "app_mention" },
          store: getStore(),
          onMessage: (message) => handleIncomingMessage(runtime(client), message),
          postError: (channel, threadTs, text) => postFailure(client, channel, threadTs, text),
        });
      },
    });
  });

  bolt.event("message", async ({ event, client, body, context }) => {
    await withDelivery({
      body,
      store: getStore(),
      context: deliveryContext(context),
      work: async () => {
        await dispatchUserMessage({
          event,
          store: getStore(),
          onMessage: (message) => handleIncomingMessage(runtime(client), message),
          postError: (channel, threadTs, text) => postFailure(client, channel, threadTs, text),
        });
        const normalized = normalizeSlackMessage(event);
        if (!normalized) return;
        try {
          await considerStatusUpdate({
            message: normalized,
            store: getStore(),
            slack: slackFromWebClient(client),
            llm: createAnthropicLlm(),
            asanaToken: process.env.ASANA_ACCESS_TOKEN,
          });
        } catch (error) {
          console.error(JSON.stringify({
            msg: "status_update_failed",
            error: error instanceof Error ? error.message : "unknown",
          }));
        }
      },
    });
  });

  for (const actionId of ["status_confirm", "status_pick", "status_choose", "status_dismiss"] as const) {
    bolt.action(actionId, async ({ ack, body, client, context }) => {
      await ack();
      const click = readStatusClick(body);
      if (!click) return;
      await withDelivery({
        body,
        store: getStore(),
        context: deliveryContext(context),
        work: () => applyStatusAction({
          ...click,
          store: getStore(),
          slack: slackFromWebClient(client),
          asanaToken: process.env.ASANA_ACCESS_TOKEN,
        }),
      });
    });
  }

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

  bolt.action("confirm_task_completion", async ({ ack, body, client, context }) => {
    await ack();
    const action = readAction(body);
    if (!action) return;
    await withDelivery({
      body,
      store: getStore(),
      context: deliveryContext(context),
      work: () => safeHandle(client, action.channel, action.threadTs, () => handleConfirmTaskCompletion(runtime(client), action)),
    });
  });

  bolt.action("cancel_task_completion", async ({ ack, body, client, context }) => {
    await ack();
    const action = readAction(body);
    if (!action) return;
    await withDelivery({
      body,
      store: getStore(),
      context: deliveryContext(context),
      work: () => safeHandle(client, action.channel, action.threadTs, () => handleCancelTaskCompletion(runtime(client), action)),
    });
  });

  for (const actionId of ["rush_approve", "rush_decline"] as const) {
    bolt.action(actionId, async ({ ack, body, client, context }) => {
      await ack();
      const click = readRushClick(body);
      if (!click) return;
      await withDelivery({
        body,
        store: getStore(),
        context: deliveryContext(context),
        work: async () => {
          const { applyRushDecision } = await import("../intake/rush-approval.js");
          const result = await applyRushDecision({
            store: getStore(),
            approvalId: click.approvalId,
            approverId: click.userId,
            decision: actionId === "rush_approve" ? "approved" : "declined",
          });
          if (result.approval) {
            await client.chat.postMessage({
              channel: result.approval.channel,
              thread_ts: result.approval.threadTs,
              text: result.text,
            });
          }
        },
      });
    });
  }

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
  const llm = createAnthropicLlm();
  const token = process.env.SLACK_BOT_TOKEN ?? "";
  return {
    store: getStore(),
    slack: slackFromWebClient(client),
    llm,
    asanaToken: process.env.ASANA_ACCESS_TOKEN,
    design: {
      canva: createCanvaDesignClient({ store: getStore(), llm }),
      download: (photo: { source: "slack" | "url"; slackFileId?: string; url?: string; name?: string }) => {
        if (photo.source === "slack" && photo.slackFileId) return downloadSlackFile({ token, fileId: photo.slackFileId });
        if (photo.url) return downloadRemoteFile({ url: photo.url, name: photo.name, token });
        return Promise.reject(new Error("That photo is missing a file or a link."));
      },
    },
  };
}

async function safeHandle(client: WebClient, channel: string, threadTs: string | undefined, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(JSON.stringify({
      msg: "intake_handler_failed",
      channel,
      threadTs,
      error: error instanceof Error ? error.message : "unknown",
    }));
    try {
      await postFailure(client, channel, threadTs, HANDLER_FAILURE_TEXT);
    } catch (postError) {
      console.error(JSON.stringify({
        msg: "slack_error_reply_failed",
        error: postError instanceof Error ? postError.message : "unknown",
      }));
      throw error;
    }
  }
}

async function postFailure(client: WebClient, channel: string, threadTs: string | undefined, text: string): Promise<void> {
  await client.chat.postMessage({ channel, thread_ts: threadTs, text });
}

function readRushClick(body: unknown): { approvalId: string; userId: string } | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as { user?: { id?: string }; actions?: Array<{ value?: string }> };
  const approvalId = record.actions?.[0]?.value;
  const userId = record.user?.id;
  if (!approvalId || !userId) return undefined;
  return { approvalId, userId };
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

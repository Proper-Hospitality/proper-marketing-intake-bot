import { isValidSlackRequest, type App } from "@slack/bolt";
import { getStore } from "../store/index.js";

export interface AcceptedSlackRequest {
  response?: Response;
  work?: () => Promise<void>;
}

export async function acceptSlackRequest(rawBody: string, headers: Headers, app: App): Promise<AcceptedSlackRequest> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET ?? "";
  if (!signingSecret) {
    console.error(JSON.stringify({ msg: "missing_signing_secret" }));
    return { response: new Response("Slack signing secret is not configured.", { status: 500 }) };
  }

  let body: Record<string, unknown>;
  try {
    body = parseSlackBody(rawBody, headers.get("content-type") ?? "");
  } catch {
    return { response: new Response("Bad request", { status: 400 }) };
  }

  const valid = isValidSlackRequest({
    signingSecret,
    body: rawBody,
    headers: {
      "x-slack-signature": headers.get("x-slack-signature") ?? "",
      "x-slack-request-timestamp": Number(headers.get("x-slack-request-timestamp")),
    },
  });
  if (!valid) return { response: new Response("Invalid signature", { status: 401 }) };

  if (body.type === "url_verification") {
    return { response: Response.json({ challenge: body.challenge }) };
  }
  if (body.ssl_check === "1" || body.ssl_check === 1) {
    return { response: new Response("", { status: 200 }) };
  }

  const retryNum = headers.get("x-slack-retry-num");
  const eventKey = idempotencyKey(body);
  if (retryNum) {
    console.log(JSON.stringify({
      msg: "slack_retry",
      retryNum,
      retryReason: headers.get("x-slack-retry-reason"),
      eventKey,
    }));
  }

  const store = getStore();
  if (eventKey) {
    const claimed = await store.claimEvent(eventKey, 60 * 15);
    if (!claimed) {
      console.log(JSON.stringify({ msg: "slack_retry_skipped", eventKey }));
      return { response: new Response("", { status: 200 }) };
    }
  }

  const retryNumber = retryNum ? Number(retryNum) : undefined;
  return {
    work: async () => {
      try {
        await app.processEvent({
          body,
          ack: async () => {},
          retryNum: retryNumber,
          retryReason: headers.get("x-slack-retry-reason") ?? undefined,
        });
      } catch (error) {
        if (eventKey) await store.releaseEvent(eventKey);
        console.error(JSON.stringify({
          msg: "slack_event_failed",
          eventKey,
          error: error instanceof Error ? error.message : "unknown",
        }));
        throw error;
      }
    },
  };
}

export function parseSlackBody(rawBody: string, contentType: string): Record<string, unknown> {
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(rawBody);
    const payload = params.get("payload");
    if (payload) return JSON.parse(payload) as Record<string, unknown>;
    return Object.fromEntries(params.entries());
  }
  const parsed = JSON.parse(rawBody) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Slack body was not an object.");
  }
  return parsed as Record<string, unknown>;
}

export function idempotencyKey(body: Record<string, unknown>): string | undefined {
  if (typeof body.event_id === "string" && body.event_id) return `event:${body.event_id}`;
  if (typeof body.trigger_id === "string" && body.trigger_id) return `trigger:${body.trigger_id}`;
  return undefined;
}

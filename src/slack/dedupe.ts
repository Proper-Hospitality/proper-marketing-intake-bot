import type { Store } from "../store/types.js";

const DELIVERY_TTL_SECONDS = 60 * 15;

export interface DeliveryContext {
  retryNum?: number;
  retryReason?: string;
}

/**
 * Slack retries the same delivery when it does not see a fast acknowledgement.
 * Events use event_id. Button clicks use trigger_id. A second delivery of the
 * same id is ignored so a retry cannot file a second Asana task.
 */
export function slackDeliveryKey(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as { event_id?: unknown; trigger_id?: unknown };
  if (typeof record.event_id === "string" && record.event_id) return `event:${record.event_id}`;
  if (typeof record.trigger_id === "string" && record.trigger_id) return `trigger:${record.trigger_id}`;
  return undefined;
}

export async function withDelivery(options: {
  body: unknown;
  store: Store;
  context?: DeliveryContext;
  work: () => Promise<void>;
}): Promise<"processed" | "duplicate"> {
  const key = slackDeliveryKey(options.body);
  const retryNum = options.context?.retryNum;
  if (retryNum) {
    console.log(JSON.stringify({
      msg: "slack_retry",
      retryNum,
      retryReason: options.context?.retryReason,
      eventKey: key,
    }));
  }
  if (key) {
    const claimed = await options.store.claimEvent(key, DELIVERY_TTL_SECONDS);
    if (!claimed) {
      console.log(JSON.stringify({ msg: "slack_retry_skipped", eventKey: key }));
      return "duplicate";
    }
  }
  try {
    await options.work();
    return "processed";
  } catch (error) {
    if (key) await options.store.releaseEvent(key);
    throw error;
  }
}

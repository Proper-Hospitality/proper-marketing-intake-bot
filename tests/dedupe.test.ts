import { describe, expect, it } from "vitest";
import { slackDeliveryKey, withDelivery } from "../src/slack/dedupe.js";
import { MemoryStore } from "../src/store/memory.js";

describe("Slack retry dedupe", () => {
  it("keys events and button clicks differently", () => {
    expect(slackDeliveryKey({ event_id: "Ev1" })).toBe("event:Ev1");
    expect(slackDeliveryKey({ trigger_id: "Tr1" })).toBe("trigger:Tr1");
    expect(slackDeliveryKey({ type: "url_verification" })).toBeUndefined();
  });

  it("runs the work once and lets a failed attempt be retried", async () => {
    const store = new MemoryStore();
    const runs: string[] = [];
    const first = await withDelivery({
      body: { event_id: "Ev9" },
      store,
      context: { retryNum: undefined },
      work: async () => {
        runs.push("first");
      },
    });
    const duplicate = await withDelivery({
      body: { event_id: "Ev9" },
      store,
      context: { retryNum: 1, retryReason: "http_timeout" },
      work: async () => {
        runs.push("duplicate");
      },
    });
    expect(first).toBe("processed");
    expect(duplicate).toBe("duplicate");
    expect(runs).toEqual(["first"]);

    await expect(withDelivery({
      body: { trigger_id: "Tr9" },
      store,
      work: async () => {
        throw new Error("asana down");
      },
    })).rejects.toThrow(/asana down/);

    const retried = await withDelivery({
      body: { trigger_id: "Tr9" },
      store,
      context: { retryNum: 1, retryReason: "http_timeout" },
      work: async () => {
        runs.push("retried");
      },
    });
    expect(retried).toBe("processed");
    expect(runs).toEqual(["first", "retried"]);
  });
});

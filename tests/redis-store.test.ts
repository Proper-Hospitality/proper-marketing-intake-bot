import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RedisStore, type KeyValueClient } from "../src/store/redis.js";
import { emptyConversation } from "../src/store/types.js";

describe("Render Key Value store", () => {
  it("saves a conversation as JSON and claims an event only once", async () => {
    const data = new Map<string, string>();
    const sets: unknown[][] = [];
    const client: KeyValueClient = {
      async get(key) {
        return data.get(key) ?? null;
      },
      async set(key, value, expiryMode, ttlSeconds, mode) {
        sets.push([key, value, expiryMode, ttlSeconds, mode]);
        if (mode === "NX" && data.has(key)) return null;
        data.set(key, value);
        return "OK";
      },
      async del(key) {
        return data.delete(key) ? 1 : 0;
      },
    };
    const store = new RedisStore(client);
    const state = emptyConversation("C1:1");
    state.draft.requestName = "Holiday newsletter";
    await store.saveConversation(state);
    const loaded = await store.getConversation("C1:1");
    expect(loaded?.draft.requestName).toBe("Holiday newsletter");
    expect(sets[0]?.[0]).toBe("intake:conv:C1:1");
    expect(sets[0]?.[2]).toBe("EX");

    expect(await store.claimEvent("event:Ev1", 900)).toBe(true);
    expect(await store.claimEvent("event:Ev1", 900)).toBe(false);
    await store.releaseEvent("event:Ev1");
    expect(await store.claimEvent("event:Ev1", 900)).toBe(true);
  });

  it("wires REDIS_URL from the internal Key Value service in the blueprint", () => {
    const blueprint = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
    expect(blueprint).toContain("type: keyvalue");
    expect(blueprint).toContain("name: proper-marketing-intake-kv");
    expect(blueprint).toContain("plan: free");
    expect(blueprint).toContain("ipAllowList: []");
    expect(blueprint).toMatch(/key: REDIS_URL[\s\S]*fromService:[\s\S]*type: keyvalue[\s\S]*name: proper-marketing-intake-kv[\s\S]*property: connectionString/);
    expect(blueprint).not.toMatch(/UPSTASH/);
  });

  it("turns on the Messages tab and leaves request URLs for after deploy", () => {
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
      features: { app_home: { messages_tab_enabled: boolean; messages_tab_read_only_enabled: boolean } };
      settings?: { event_subscriptions?: unknown; interactivity?: unknown };
    };
    expect(manifest.features.app_home).toEqual({
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    });
    expect(manifest.settings?.event_subscriptions).toBeUndefined();
    expect(manifest.settings?.interactivity).toBeUndefined();
  });
});
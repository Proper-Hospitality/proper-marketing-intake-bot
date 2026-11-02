import { MemoryStore } from "./memory.js";
import { createRedisStore } from "./redis.js";
import type { Store } from "./types.js";

let singleton: Store | undefined;

export function getStore(): Store {
  if (singleton) return singleton;
  const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  if (hasRedis) {
    singleton = createRedisStore();
    return singleton;
  }
  if (process.env.VERCEL) {
    throw new Error(
      "This deployment has no Upstash Redis credentials. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }
  console.warn("UPSTASH_REDIS_REST_URL is not set. Using in-memory state that disappears when the process stops.");
  singleton = new MemoryStore();
  return singleton;
}

export function setStore(store: Store): void {
  singleton = store;
}

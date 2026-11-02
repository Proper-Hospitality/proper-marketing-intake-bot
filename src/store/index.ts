import { MemoryStore } from "./memory.js";
import { createRedisStore } from "./redis.js";
import type { Store } from "./types.js";

let singleton: Store | undefined;

export function getStore(): Store {
  if (singleton) return singleton;
  if (process.env.REDIS_URL) {
    singleton = createRedisStore();
    return singleton;
  }
  if (process.env.RENDER) {
    throw new Error(
      "REDIS_URL is missing. The blueprint should set it from the Key Value service. You do not type this value yourself. Re-apply render.yaml if the web service has no REDIS_URL.",
    );
  }
  console.warn("REDIS_URL is not set. Using in-memory state that disappears when the process stops.");
  singleton = new MemoryStore();
  return singleton;
}

export function setStore(store: Store): void {
  singleton = store;
}

import { Redis } from "ioredis";
import type { ConversationState, Store } from "./types.js";

const CONVERSATION_TTL_SECONDS = 60 * 60 * 24 * 45;

/** The commands this store uses. ioredis satisfies this, and tests pass a fake. */
export interface KeyValueClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: "EX", ttlSeconds: number, mode?: "NX"): Promise<string | null>;
  del(key: string): Promise<number>;
}

export class RedisStore implements Store {
  constructor(private readonly redis: KeyValueClient) {}

  async getConversation(key: string): Promise<ConversationState | null> {
    const value = await this.redis.get(conversationRedisKey(key));
    if (!value) return null;
    return JSON.parse(value) as ConversationState;
  }

  async saveConversation(state: ConversationState): Promise<void> {
    await this.redis.set(conversationRedisKey(state.key), JSON.stringify(state), "EX", CONVERSATION_TTL_SECONDS);
  }

  async claimEvent(id: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(`intake:event:${id}`, "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  }

  async releaseEvent(id: string): Promise<void> {
    await this.redis.del(`intake:event:${id}`);
  }

  async getValue(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async setValue(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, "EX", ttlSeconds);
  }
}

function conversationRedisKey(key: string): string {
  return `intake:conv:${key}`;
}

export function createRedisStore(url = process.env.REDIS_URL): RedisStore {
  if (!url) throw new Error("REDIS_URL is not set.");
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    connectTimeout: 10_000,
  });
  client.on("error", (error: Error) => {
    console.error(JSON.stringify({ msg: "redis_error", error: error.message }));
  });
  return new RedisStore(client);
}

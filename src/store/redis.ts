import { Redis } from "@upstash/redis";
import type { ConversationState, Store } from "./types.js";

const CONVERSATION_TTL_SECONDS = 60 * 60 * 24 * 45;

export class RedisStore implements Store {
  constructor(private readonly redis: Redis) {}

  async getConversation(key: string): Promise<ConversationState | null> {
    const value = await this.redis.get<ConversationState>(conversationRedisKey(key));
    return value ?? null;
  }

  async saveConversation(state: ConversationState): Promise<void> {
    await this.redis.set(conversationRedisKey(state.key), state, { ex: CONVERSATION_TTL_SECONDS });
  }

  async claimEvent(id: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(`intake:event:${id}`, "1", { nx: true, ex: ttlSeconds });
    return result === "OK";
  }

  async releaseEvent(id: string): Promise<void> {
    await this.redis.del(`intake:event:${id}`);
  }
}

function conversationRedisKey(key: string): string {
  return `intake:conv:${key}`;
}

export function createRedisStore(): RedisStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.");
  }
  return new RedisStore(new Redis({ url, token }));
}

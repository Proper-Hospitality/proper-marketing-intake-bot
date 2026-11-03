import type { ConversationState, Store } from "./types.js";

export class MemoryStore implements Store {
  readonly conversations = new Map<string, ConversationState>();
  readonly events = new Map<string, number>();
  readonly values = new Map<string, { value: string; expires: number }>();

  async getConversation(key: string): Promise<ConversationState | null> {
    const found = this.conversations.get(key);
    return found ? structuredClone(found) : null;
  }

  async saveConversation(state: ConversationState): Promise<void> {
    this.conversations.set(state.key, structuredClone(state));
  }

  async claimEvent(id: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const expires = this.events.get(id);
    if (expires && expires > now) return false;
    this.events.set(id, now + ttlSeconds * 1000);
    return true;
  }

  async releaseEvent(id: string): Promise<void> {
    this.events.delete(id);
  }

  async getValue(key: string): Promise<string | null> {
    const found = this.values.get(key);
    if (!found) return null;
    if (found.expires <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return found.value;
  }

  async setValue(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.values.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  }
}

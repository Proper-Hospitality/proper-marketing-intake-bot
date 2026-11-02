import type { ConversationState, Store } from "./types.js";

export class MemoryStore implements Store {
  readonly conversations = new Map<string, ConversationState>();
  readonly events = new Map<string, number>();

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
}

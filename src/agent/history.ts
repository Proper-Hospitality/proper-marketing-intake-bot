import type { ChatTurn } from "../store/types.js";

export interface ReplayBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
  signature?: string;
  data?: string;
}

/**
 * Blocks sent back to Claude while a tool turn is still open.
 * A thinking block is valid only with both `thinking` and `signature`.
 * Dropping either field makes the next request fail with
 * `thinking.thinking: Field required`.
 */
export function assistantBlocksForReplay(blocks: unknown[]): ReplayBlock[] {
  const kept: ReplayBlock[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type === "thinking") {
      if (typeof record.thinking === "string" && typeof record.signature === "string") {
        kept.push({ type: "thinking", thinking: record.thinking, signature: record.signature });
      }
      continue;
    }
    if (record.type === "redacted_thinking") {
      if (typeof record.data === "string") kept.push({ type: "redacted_thinking", data: record.data });
      continue;
    }
    if (record.type === "text" && typeof record.text === "string") {
      kept.push({ type: "text", text: record.text });
      continue;
    }
    if (record.type === "tool_use" && typeof record.id === "string" && typeof record.name === "string") {
      kept.push({ type: "tool_use", id: record.id, name: record.name, input: record.input ?? {} });
    }
  }
  return kept;
}

/** Turn stored history into plain text. Prior-turn thinking blocks are not replayed. */
export function sanitizeStoredHistory(turns: Array<{ role?: string; content?: unknown }>): ChatTurn[] {
  const cleaned: ChatTurn[] = [];
  for (const turn of turns) {
    if (turn.role !== "user" && turn.role !== "assistant") continue;
    const text = textFromStoredContent(turn.content);
    if (!text) continue;
    const previous = cleaned[cleaned.length - 1];
    if (previous && previous.role === turn.role) {
      previous.content = `${previous.content}\n${text}`;
      continue;
    }
    cleaned.push({ role: turn.role, content: text });
  }
  return cleaned;
}

export function textFromStoredContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const record = block as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") return record.text.trim();
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function isHistoryRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
  const aboutMessages = /messages\.\d+/i.test(message);
  const aboutThinking = /thinking/i.test(message);
  if (aboutMessages && aboutThinking) return true;
  if (status === 400 && aboutMessages && /invalid_request_error|field required/i.test(message)) return true;
  return false;
}

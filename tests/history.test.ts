import { describe, expect, it, vi } from "vitest";
import { runIntakeTurn, type Llm, type LlmContentBlock } from "../src/agent/run.js";
import { assistantBlocksForReplay, isHistoryRejection, sanitizeStoredHistory } from "../src/agent/history.js";
import { emptyConversation } from "../src/store/types.js";

describe("conversation history", () => {
  it("keeps a complete thinking block and drops one that would 400", () => {
    const replayed = assistantBlocksForReplay([
      { type: "thinking" },
      { type: "thinking", thinking: "look at the thread", signature: "sig-1" },
      { type: "redacted_thinking" },
      { type: "redacted_thinking", data: "opaque" },
      { type: "text", text: "Here is the list." },
      { type: "tool_use", id: "toolu_1", name: "search_open_tasks", input: { assigneeName: "Elena" } },
    ]);
    expect(replayed).toEqual([
      { type: "thinking", thinking: "look at the thread", signature: "sig-1" },
      { type: "redacted_thinking", data: "opaque" },
      { type: "text", text: "Here is the list." },
      { type: "tool_use", id: "toolu_1", name: "search_open_tasks", input: { assigneeName: "Elena" } },
    ]);
  });

  it("strips stored thinking blocks down to plain text before the next turn", () => {
    const cleaned = sanitizeStoredHistory([
      { role: "user", content: "first ask" },
      {
        role: "assistant",
        content: [
          { type: "thinking" },
          { type: "thinking", thinking: "dropped on purpose", signature: "sig" },
          { type: "text", text: "I can look that up." },
        ],
      },
      { role: "assistant", content: [{ type: "thinking" }] },
      { role: "user", content: "  " },
    ]);
    expect(cleaned).toEqual([
      { role: "user", content: "first ask" },
      { role: "assistant", content: "I can look that up." },
    ]);
    expect(JSON.stringify(cleaned)).not.toContain("thinking");
  });

  it("recognizes the production 400 for a malformed thinking block", () => {
    const error = new Error("messages.23.content.0.thinking.thinking: Field required");
    (error as Error & { status: number }).status = 400;
    expect(isHistoryRejection(error)).toBe(true);
    expect(isHistoryRejection(new Error("Asana returned 400"))).toBe(false);
  });

  it("resets a thread's history and retries once after Anthropic rejects it", async () => {
    const seen: unknown[] = [];
    let calls = 0;
    const llm: Llm = {
      async complete({ messages }) {
        calls += 1;
        seen.push(messages);
        if (calls === 1) {
          const error = new Error("invalid_request_error messages.23.content.0.thinking.thinking: Field required");
          (error as Error & { status: number }).status = 400;
          throw error;
        }
        return { content: [{ type: "text", text: "Recovered. What do you need?" }] };
      },
    };
    const state = emptyConversation("C1:thread");
    state.messages = [
      { role: "user", content: "old question" },
      { role: "assistant", content: [{ type: "thinking" }] as unknown as string },
    ];
    const reply = await runIntakeTurn({
      state,
      userText: "how many overdue tasks does DeeDee have",
      slackUser: { id: "U1", name: "Sam Lee", email: "sam@example.com" },
      llm,
    });
    expect(calls).toBe(2);
    expect(JSON.stringify(seen[0])).not.toContain('"type":"thinking"');
    expect(seen[1]).toEqual([{ role: "user", content: "how many overdue tasks does DeeDee have" }]);
    expect(reply.text).toContain("Recovered");
    expect(state.messages.map((turn) => turn.content).join(" ")).not.toContain("thinking");
    expect(state.messages.some((turn) => turn.content === "old question")).toBe(false);
  });

  it("sends thinking text and signature back during a tool turn", async () => {
    const seen: unknown[] = [];
    let calls = 0;
    const llm: Llm = {
      async complete({ messages }) {
        calls += 1;
        seen.push(messages);
        if (calls === 1) {
          const blocks: LlmContentBlock[] = [
            { type: "thinking", thinking: "check the name", signature: "sig-keep" },
            { type: "tool_use", id: "toolu_bad", name: "record_answers", input: { requestType: "NotARealType" } },
          ];
          return { content: blocks };
        }
        return { content: [{ type: "text", text: "Which kind of request is this?" }] };
      },
    };
    const state = emptyConversation("D1:dm");
    await runIntakeTurn({
      state,
      userText: "need something designed",
      slackUser: { id: "U1", name: "Sam Lee" },
      llm,
    });
    const second = seen[1] as Array<{ role: string; content: unknown }>;
    const assistant = second.find((turn) => turn.role === "assistant");
    expect(assistant?.content).toEqual([
      { type: "thinking", thinking: "check the name", signature: "sig-keep" },
      { type: "tool_use", id: "toolu_bad", name: "record_answers", input: { requestType: "NotARealType" } },
    ]);
  });
});

describe("history rejection log", () => {
  it("logs the reset", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      if (typeof line === "string") lines.push(line);
    });
    const llm: Llm = {
      async complete() {
        if (lines.length === 0) {
          const error = new Error("messages.2.content.0.thinking.thinking: Field required");
          (error as Error & { status: number }).status = 400;
          throw error;
        }
        return { content: [{ type: "text", text: "ok" }] };
      },
    };
    await runIntakeTurn({
      state: emptyConversation("C9:1"),
      userText: "hello",
      slackUser: { id: "U1", name: "Sam" },
      llm,
    });
    spy.mockRestore();
    expect(lines.some((line) => line.includes("history_reset") && line.includes("thinking.thinking"))).toBe(true);
  });
});

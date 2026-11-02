import Anthropic from "@anthropic-ai/sdk";
import { assistantBlocksForReplay } from "./history.js";
import type { Llm, LlmContentBlock } from "./run.js";

export function createAnthropicLlm(): Llm {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const client = new Anthropic({ apiKey });
  return {
    model,
    async complete({ system, messages, tools }) {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system,
        tools: tools as Anthropic.Tool[],
        messages: messages as Anthropic.MessageParam[],
      });
      const content: LlmContentBlock[] = assistantBlocksForReplay(response.content);
      return { content };
    },
  };
}

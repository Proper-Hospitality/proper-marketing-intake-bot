import Anthropic from "@anthropic-ai/sdk";
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
      const content: LlmContentBlock[] = response.content.map((block) => {
        if (block.type === "text") return { type: "text", text: block.text };
        if (block.type === "tool_use") {
          return { type: "tool_use", id: block.id, name: block.name, input: block.input };
        }
        return { type: block.type };
      });
      return { content };
    },
  };
}

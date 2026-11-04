import type { FieldMapper } from "./map-fields.js";
import { stripDesignCopy } from "./materials.js";

export async function extractDesignCopy(args: { llm?: FieldMapper; text: string }): Promise<string | undefined> {
  const fallback = stripDesignCopy(args.text);
  if (!args.llm) return fallback;
  try {
    const response = await args.llm.complete({
      system: [
        "Pull only the words that should appear on a Canva design out of a Slack message.",
        "Reply with JSON only: {\"copy\":\"the design words\"}.",
        "Drop lead-ins such as \"here's the copy and the photo\", list numbers, and notes that a photo is attached.",
        "Do not invent words. If the message has no design copy, return {\"copy\":\"\"}.",
      ].join(" "),
      messages: [{ role: "user", content: args.text }],
      tools: [],
    });
    const text = response.content.filter((block) => block.type === "text" && block.text).map((block) => block.text).join("\n");
    const parsed = readCopy(text);
    if (parsed && !/here(?:'s| is)\s+the\s+copy/i.test(parsed)) return parsed;
  } catch (error) {
    console.error(JSON.stringify({
      msg: "canva_copy_extract_failed",
      error: error instanceof Error ? error.message : "unknown",
    }));
  }
  return fallback;
}

function readCopy(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { copy?: unknown };
    if (typeof parsed.copy !== "string") return undefined;
    const copy = parsed.copy.replace(/\s+/g, " ").trim();
    return copy.length >= 8 ? copy : undefined;
  } catch {
    return undefined;
  }
}

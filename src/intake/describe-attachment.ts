import Anthropic from "@anthropic-ai/sdk";

const PROMPT = "Extract the written specs from this file (sizes, ratios, dimensions, and other ad or print requirements). Return only those specs, in the file's own words. If there is no spec text, return nothing.";

const IMAGES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Read an image or a scanned PDF with Claude. Empty string when the call fails. */
export async function describeAttachment(args: {
  name: string;
  mimetype: string;
  bytes: Uint8Array;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";
  if (args.mimetype !== "application/pdf" && !IMAGES.has(args.mimetype)) return "";
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const client = new Anthropic({ apiKey });
  const data = Buffer.from(args.bytes).toString("base64");
  const fileBlock = args.mimetype === "application/pdf"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
    : {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: args.mimetype as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data,
      },
    };
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 800,
      messages: [{
        role: "user",
        content: [fileBlock, { type: "text", text: PROMPT }],
      }],
    });
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim()
      .slice(0, 1500);
  } catch (error) {
    console.error(JSON.stringify({
      msg: "attachment_describe_failed",
      name: args.name,
      error: error instanceof Error ? error.message : "unknown",
    }));
    return "";
  }
}

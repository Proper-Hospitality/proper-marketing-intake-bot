export interface FieldMapper {
  complete(args: {
    system: string;
    messages: unknown[];
    tools: readonly unknown[];
  }): Promise<{ content: Array<{ type: string; text?: string }> }>;
}

export function parseFieldMap(text: string, fieldNames: string[]): Record<string, string> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
  const fields = record.fields && typeof record.fields === "object" && !Array.isArray(record.fields)
    ? record.fields as Record<string, unknown>
    : record;
  const allowed = new Set(fieldNames);
  const mapped: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (!allowed.has(name) || typeof value !== "string") continue;
    mapped[name] = value;
  }
  return mapped;
}

export async function mapCopyToTextFields(args: {
  llm: FieldMapper;
  fieldNames: string[];
  copy: string;
}): Promise<Record<string, string>> {
  if (args.fieldNames.length === 0) return {};
  if (args.fieldNames.length === 1) return { [args.fieldNames[0]]: args.copy };
  try {
    const response = await args.llm.complete({
      system: [
        "Map the requester's copy onto Canva autofill text fields.",
        "Reply with JSON only: {\"fields\": {\"Exact Field Name\": \"text\"}}.",
        "Use only the field names you were given. Use the requester's words. Do not invent claims, prices, or dates.",
        "Put each part of the copy in the field it belongs in. If a field has no matching words, use an empty string.",
      ].join(" "),
      messages: [{
        role: "user",
        content: `Field names:\n${args.fieldNames.map((name) => `- ${name}`).join("\n")}\n\nCopy:\n${args.copy}`,
      }],
      tools: [],
    });
    const text = response.content.filter((block) => block.type === "text" && block.text).map((block) => block.text).join("\n");
    const mapped = parseFieldMap(text, args.fieldNames);
    if (Object.values(mapped).some((value) => value.trim())) return mapped;
  } catch (error) {
    console.error(JSON.stringify({
      msg: "canva_field_map_failed",
      error: error instanceof Error ? error.message : "unknown",
    }));
  }
  return { [args.fieldNames[0]]: args.copy };
}

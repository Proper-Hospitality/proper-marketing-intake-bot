import type { FieldMapper } from "../canva/map-fields.js";
import { normalizeDate } from "../intake/catalog.js";

export type StatusIntent =
  | { kind: "none" }
  | { kind: "complete"; note: string; query: string }
  | { kind: "due"; dueOn: string; note: string; query: string }
  | { kind: "comment"; note: string; query: string };

export function parseStatusIntent(raw: string): StatusIntent {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { kind: "none" };
  let parsed: { intent?: unknown; dueOn?: unknown; note?: unknown; query?: unknown };
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as typeof parsed;
  } catch {
    return { kind: "none" };
  }
  const note = typeof parsed.note === "string" ? parsed.note.trim() : "";
  const query = typeof parsed.query === "string" ? parsed.query.trim() : "";
  if (parsed.intent === "complete") return { kind: "complete", note, query };
  if (parsed.intent === "comment") return note ? { kind: "comment", note, query } : { kind: "none" };
  if (parsed.intent === "due") {
    const dueOn = typeof parsed.dueOn === "string" ? normalizeDate(parsed.dueOn) : undefined;
    if (!dueOn) return { kind: "none" };
    return { kind: "due", dueOn, note, query };
  }
  return { kind: "none" };
}

export async function interpretStatus(llm: FieldMapper, text: string): Promise<StatusIntent> {
  const response = await llm.complete({
    system: [
      "Decide whether a Slack message is a status update for an existing marketing task.",
      "Reply with JSON only: {\"intent\":\"complete\"|\"due\"|\"comment\"|\"none\",\"dueOn\":\"YYYY-MM-DD\"|null,\"note\":\"\",\"query\":\"\"}.",
      "complete: the work is done, live, sent, posted, or no longer needed.",
      "due: they give a new due date. dueOn must be YYYY-MM-DD.",
      "comment: a progress note that should be added to the task, and the task stays open.",
      "none: chit-chat, questions, or a new request for the marketing team.",
      "query is a few words from the message that would appear in the Asana task name. note is the short update in their words. Do not invent dates or task names.",
    ].join(" "),
    messages: [{ role: "user", content: text.slice(0, 4000) }],
    tools: [],
  });
  const textOut = response.content.filter((block) => block.type === "text" && block.text).map((block) => block.text).join("\n");
  return parseStatusIntent(textOut);
}

export function proposedChangeLabel(intent: StatusIntent): string {
  if (intent.kind === "complete") {
    return intent.note ? `Mark complete. Note: ${intent.note}` : "Mark complete";
  }
  if (intent.kind === "due") {
    return intent.note ? `Set the due date to ${intent.dueOn}. Note: ${intent.note}` : `Set the due date to ${intent.dueOn}`;
  }
  if (intent.kind === "comment") return `Add a comment: ${intent.note}`;
  return "";
}

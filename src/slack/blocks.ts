import type { KnownBlock } from "@slack/types";

export function messageBlocks(text: string): KnownBlock[] {
  return chunk(text).map((part) => ({
    type: "section",
    text: { type: "mrkdwn", text: part },
  }));
}

export function confirmBlocks(summary: string, version: number): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Confirm this request", emoji: true },
    },
    ...messageBlocks(summary),
    { type: "divider" },
    {
      type: "actions",
      block_id: `intake_confirm_${version}`,
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Confirm", emoji: true },
          action_id: "confirm_intake",
          value: String(version),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Make changes", emoji: true },
          action_id: "revise_intake",
          value: String(version),
        },
      ],
    },
  ];
  return blocks;
}

function chunk(text: string): string[] {
  const clean = text.trim();
  if (!clean) return ["(empty)"];
  const chunks: string[] = [];
  let current = "";
  for (const line of clean.split("\n")) {
    const piece = line.length > 2800 ? line.slice(0, 2800) : line;
    const next = current ? `${current}\n${piece}` : piece;
    if (next.length > 2800) {
      if (current) chunks.push(current);
      current = piece;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

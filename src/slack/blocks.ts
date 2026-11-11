import type { KnownBlock } from "@slack/types";

export function messageBlocks(text: string): KnownBlock[] {
  return chunk(text).map((part) => ({
    type: "section",
    text: { type: "mrkdwn", text: part },
  }));
}

export function confirmTaskCompletionBlocks(summary: string, version: number): KnownBlock[] {
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "Mark these tasks complete", emoji: true },
    },
    ...messageBlocks(summary),
    { type: "divider" },
    {
      type: "actions",
      block_id: `task_complete_${version}`,
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Confirm", emoji: true },
          action_id: "confirm_task_completion",
          value: String(version),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Cancel", emoji: true },
          action_id: "cancel_task_completion",
          value: String(version),
        },
      ],
    },
  ];
}

export function emailSplitBlocks(text: string, count: number): KnownBlock[] {
  const splitLabel = `Split into ${count} requests`;
  return [
    ...messageBlocks(text),
    { type: "divider" },
    {
      type: "actions",
      block_id: "email_split_choice",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: splitLabel.slice(0, 75), emoji: true },
          action_id: "email_split",
          value: "split",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Keep as one", emoji: true },
          action_id: "email_keep",
          value: "keep",
        },
      ],
    },
  ];
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

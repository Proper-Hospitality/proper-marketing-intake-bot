import type { KnownBlock } from "@slack/types";
import { messageBlocks } from "../slack/blocks.js";

export function reviewBlocks(text: string, taskGid: string): KnownBlock[] {
  return [
    ...messageBlocks(text),
    {
      type: "actions",
      block_id: `review_${taskGid}`,
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Approve", emoji: true },
          action_id: "review_approve",
          value: taskGid,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Request changes", emoji: true },
          action_id: "review_changes",
          value: taskGid,
        },
      ],
    },
  ];
}

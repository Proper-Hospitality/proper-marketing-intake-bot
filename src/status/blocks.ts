import type { KnownBlock, Button } from "@slack/types";
import type { ListedTask } from "../store/types.js";
import type { StatusIntent } from "./intent.js";
import { proposedChangeLabel } from "./intent.js";

export interface StatusProposal {
  id: string;
  channel: string;
  threadTs: string;
  messageTs: string;
  speakerId: string;
  speakerName: string;
  permalink: string;
  intent: Exclude<StatusIntent, { kind: "none" }>;
  tasks: ListedTask[];
  selectedGid?: string;
  cardTs?: string;
  ephemeral: boolean;
}

export function statusProposalBlocks(proposal: StatusProposal, view: "confirm" | "choice" | "done" | "dismissed" | "denied" | "failed", detail?: string): KnownBlock[] {
  if (view === "done") {
    return [{ type: "section", text: { type: "mrkdwn", text: detail || "Updated the Asana task." } }];
  }
  if (view === "dismissed") {
    return [{ type: "section", text: { type: "mrkdwn", text: "Dismissed. I didn't change the Asana task." } }];
  }
  if (view === "denied") {
    return [{ type: "section", text: { type: "mrkdwn", text: "Only the person who wrote that update, or the Asana assignee, can confirm it." } }];
  }
  if (view === "failed") {
    return [{ type: "section", text: { type: "mrkdwn", text: detail || "I couldn't update that Asana task." } }];
  }
  const selected = proposal.tasks.find((task) => task.gid === proposal.selectedGid) ?? proposal.tasks[0];
  if (view === "choice" || !selected) {
    return [
      { type: "section", text: { type: "mrkdwn", text: "Which Asana task should I update?" } },
      ...proposal.tasks.map((task) => ({
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: `*${task.name}*\n${task.url}` },
      })),
      {
        type: "actions",
        block_id: `status_choice_${proposal.id}`,
        elements: [
          ...proposal.tasks.map((task) => button(`Use ${clip(task.name, 60)}`, "status_choose", `${proposal.id}|${task.gid}`)),
          button("Dismiss", "status_dismiss", proposal.id),
        ],
      },
    ];
  }
  const elements: Button[] = [button("Confirm", "status_confirm", proposal.id, true)];
  if (proposal.tasks.length > 1) elements.push(button("Pick another task", "status_pick", proposal.id));
  elements.push(button("Dismiss", "status_dismiss", proposal.id));
  return [
    { type: "header", text: { type: "plain_text", text: "Update this Asana task?", emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: `*${selected.name}*\n${selected.url}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Proposed change:* ${proposedChangeLabel(proposal.intent)}` } },
    { type: "actions", block_id: `status_confirm_${proposal.id}`, elements },
  ];
}

export function canConfirmStatus(input: {
  clickerId: string;
  speakerId: string;
  clickerAsanaGid?: string;
  assigneeGid?: string;
}): boolean {
  if (input.clickerId === input.speakerId) return true;
  return Boolean(input.clickerAsanaGid && input.assigneeGid && input.clickerAsanaGid === input.assigneeGid);
}

export function statusComment(input: { name: string; permalink: string; change: string }): string {
  return [`Updated from Slack by ${input.name}`, input.permalink, input.change].filter(Boolean).join("\n");
}

function button(label: string, actionId: string, value: string, primary = false): Button {
  return {
    type: "button",
    ...(primary ? { style: "primary" as const } : {}),
    text: { type: "plain_text", text: clip(label, 75), emoji: true },
    action_id: actionId,
    value,
  };
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

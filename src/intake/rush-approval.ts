import type { KnownBlock } from "@slack/types";
import type { ConversationState, Store } from "../store/types.js";
import { rushAllowsApproval, rushApprovers, type RushReason } from "./rush.js";

export interface RushApproval {
  id: string;
  conversationKey: string;
  channel: string;
  threadTs?: string;
  date: string;
  summary: string;
  reason: RushReason;
  status: "pending" | "approved" | "declined";
  decidedById?: string;
  decidedByName?: string;
}

const TTL_SECONDS = 60 * 60 * 24 * 14;

export function rushApprovalKey(id: string): string {
  return `intake:rush:${id}`;
}

export function rushApprovalBlocks(summary: string, id: string): KnownBlock[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: summary } },
    {
      type: "actions",
      block_id: `rush_${id}`,
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Approve", emoji: true },
          action_id: "rush_approve",
          value: id,
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "Decline", emoji: true },
          action_id: "rush_decline",
          value: id,
        },
      ],
    },
  ];
}

export async function saveRushApproval(store: Store, approval: RushApproval): Promise<void> {
  await store.setValue(rushApprovalKey(approval.id), JSON.stringify(approval), TTL_SECONDS);
}

export async function loadRushApproval(store: Store, id: string): Promise<RushApproval | null> {
  const raw = await store.getValue(rushApprovalKey(id));
  if (!raw) return null;
  return JSON.parse(raw) as RushApproval;
}

export async function startRushApproval(input: {
  state: ConversationState;
  store: Store;
  date: string;
  reason: RushReason;
  summary: string;
  channel: string;
  threadTs?: string;
  postDm: (userId: string, text: string, blocks: KnownBlock[]) => Promise<void>;
}): Promise<RushApproval> {
  if (!rushAllowsApproval(input.reason)) {
    throw new Error("Saturday and Sunday due dates cannot be approved.");
  }
  const id = `rush_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const approval: RushApproval = {
    id,
    conversationKey: input.state.key,
    channel: input.channel,
    threadTs: input.threadTs,
    date: input.date,
    summary: input.summary,
    reason: input.reason,
    status: "pending",
  };
  await saveRushApproval(input.store, approval);
  input.state.draft.rushApprovalId = id;
  const text = `${input.summary}\n\nApprove or decline this rush date.`;
  const blocks = rushApprovalBlocks(text, id);
  for (const approver of rushApprovers()) {
    await input.postDm(approver.id, text, blocks);
  }
  return approval;
}

export function approverName(userId: string): string | undefined {
  return rushApprovers().find((approver) => approver.id === userId)?.name;
}

export async function applyRushDecision(input: {
  store: Store;
  approvalId: string;
  approverId: string;
  decision: "approved" | "declined";
}): Promise<{ ok: boolean; text: string; approval?: RushApproval }> {
  const name = approverName(input.approverId);
  if (!name) return { ok: false, text: "Only Koral Captain or DeeDee Brown can approve this date." };
  const approval = await loadRushApproval(input.store, input.approvalId);
  if (!approval) return { ok: false, text: "That approval request is no longer on file." };
  if (approval.status !== "pending") return { ok: false, text: `This date was already ${approval.status}.`, approval };
  const state = await input.store.getConversation(approval.conversationKey);
  if (!state) return { ok: false, text: "I couldn't find the original request." };
  approval.status = input.decision;
  approval.decidedById = input.approverId;
  approval.decidedByName = name;
  await saveRushApproval(input.store, approval);
  if (input.decision === "approved") {
    state.draft.rushApprovedFor = approval.date;
    state.draft.rushApprovedBy = name;
    delete state.draft.rushBlock;
    await input.store.saveConversation(state);
    return { ok: true, text: `Rush approved by ${name}. The requester can confirm the brief.`, approval };
  }
  delete state.draft.requestedCompletionDate;
  delete state.draft.rushBlock;
  delete state.draft.rushApprovedFor;
  state.phase = "collecting";
  await input.store.saveConversation(state);
  return { ok: true, text: `${name} declined ${approval.date}. Ask the requester for a later date.`, approval };
}

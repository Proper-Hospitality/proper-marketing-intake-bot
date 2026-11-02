import type { BriefDraft } from "../intake/types.js";
import type { TemplateMatchResult } from "../intake/templates.js";

export type Phase =
  | "collecting"
  | "template_offered"
  | "awaiting_confirm"
  | "submitting"
  | "submitted"
  | "template_accepted"
  | "awaiting_task_completion"
  | "tasks_completed";

export interface ListedTask {
  gid: string;
  name: string;
  assigneeName: string;
  assigneeGid?: string;
  projectNames: string[];
  dueOn?: string;
  url: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface DuplicateTask {
  gid: string;
  name: string;
  url?: string;
}

export interface ConversationState {
  key: string;
  phase: Phase;
  draft: BriefDraft;
  messages: ChatTurn[];
  templateOffer: TemplateMatchResult | null;
  templateDeclinedReason?: string;
  templateDeclinedFor?: string;
  confirmVersion: number;
  taskGid?: string;
  taskUrl?: string;
  fieldsApplied: number;
  slackUserId?: string;
  channel?: string;
  threadTs?: string;
  duplicates: DuplicateTask[];
  lastTaskSearch?: ListedTask[];
  pendingCompletion?: ListedTask[];
  completionRequesterName?: string;
  completionRequesterEmail?: string;
  completionReport?: string;
  updatedAt: string;
}

export interface Store {
  getConversation(key: string): Promise<ConversationState | null>;
  saveConversation(state: ConversationState): Promise<void>;
  claimEvent(id: string, ttlSeconds: number): Promise<boolean>;
  releaseEvent(id: string): Promise<void>;
}

export function emptyConversation(key: string): ConversationState {
  return {
    key,
    phase: "collecting",
    draft: {},
    messages: [],
    templateOffer: null,
    confirmVersion: 0,
    fieldsApplied: 0,
    duplicates: [],
    updatedAt: new Date().toISOString(),
  };
}

export function conversationKey(channel: string, threadTs: string | undefined, messageTs: string, isDm: boolean): string {
  if (isDm && !threadTs) return `${channel}:dm`;
  return `${channel}:${threadTs || messageTs}`;
}

export function conversationKeyFromAction(channel: string, threadTs: string | undefined): string {
  if (threadTs) return `${channel}:${threadTs}`;
  return `${channel}:dm`;
}

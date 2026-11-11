import type { RequestType } from "../types.js";

/**
 * A normalized inbound email. Slack channel email is the only source wired up.
 * A later mailbox webhook can build this same object and call beginEmailIntake.
 */
export type EmailSourceKind = "slack-channel-email" | "mailbox";

export interface EmailParty {
  name?: string;
  email?: string;
  title?: string;
}

export interface EmailFileRef {
  slackFileId: string;
  name: string;
  permalink?: string;
  mimetype?: string;
  /** The Slack email file itself, or a file that was attached to that email. */
  role: "email" | "attachment";
}

export interface InboundEmail {
  source: EmailSourceKind;
  channel: string;
  messageTs: string;
  /** Set when a person posted the email. The Email app does not set this. */
  slackUserId?: string;
  forwarder: EmailParty;
  originalSender: EmailParty;
  forwarded: boolean;
  subject: string;
  bodyText: string;
  files: EmailFileRef[];
}

export interface EmailProposal {
  title: string;
  detail: string;
  requestType?: RequestType;
  taskType?: string;
  followUps?: Record<string, string>;
  whereItGoesLive?: string;
}

export interface EmailIntakeState {
  source: EmailSourceKind;
  messageTs: string;
  subject: string;
  originalRequester: string;
  originalName?: string;
  originalEmail?: string;
  forwarder: string;
  forwarded: boolean;
  bodyText: string;
  proposals: EmailProposal[];
  mode?: "split" | "single";
  activeIndex?: number;
  filed: Array<{ name: string; url?: string; gid?: string }>;
  files: EmailFileRef[];
}

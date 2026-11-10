export const REQUEST_TYPES = ["Creative", "Web", "CRM & Paid", "Social", "Marketing"] as const;

export type RequestType = (typeof REQUEST_TYPES)[number];

export interface BriefDraft {
  requesterName?: string;
  requesterEmail?: string;
  requestName?: string;
  properties?: string[];
  requestedCompletionDate?: string;
  consequenceOfDelay?: string;
  requestType?: RequestType;
  taskType?: string;
  followUps?: Record<string, string>;
  approver?: string;
  whereItGoesLive?: string;
  finalCopy?: string;
  copyOwner?: string;
  copyDueDate?: string;
  assets?: string[];
  assetsOwner?: string;
  assetsDue?: string;
  /** Files, uploads, Dropbox links, or website links that belong to this request. */
  attachments?: RequestAttachment[];
  /** The requester is sending files, even if the link has not arrived yet. */
  involvesFiles?: boolean;
  /** They could not provide the file and flagged it for marketing. */
  filesDeferred?: boolean;
  templateUnusedReason?: string;
  notes?: string;
  filingOnBehalf?: boolean;
  /** Price, pricing, or cost is not ready. Other required answers are still required. */
  pricePending?: boolean;
  /** Questions the requester skipped with "skip" or "not sure". */
  skipped?: Array<{ id: string; label: string }>;
  /** Year the requester asked for, when they named one. Not taken from a file's modified date. */
  collateralYear?: number;
  /** They skipped the year question, so matches stay labeled with each file's own year. */
  collateralYearUnspecified?: boolean;
  /** Existing file, or a change to that file. Set after one disambiguating question. */
  deliverableIntent?: "existing" | "modification";
  /** Set when the requested date is same-day, next-day, or a weekend rule. */
  rushBlock?: "same_day" | "next_day" | "friday_monday" | "weekend";
  /** The date Koral or DeeDee approved. */
  rushApprovedFor?: string;
  /** Name of the approver. Kept outside the Brief question/answer lines. */
  rushApprovedBy?: string;
  rushApprovalId?: string;
}

export const ATTACHMENT_KINDS = ["menu_or_brochure", "photo", "page_content", "context"] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface RequestAttachment {
  /** Filename, Slack upload name, Dropbox link, or website link. */
  ref: string;
  kind?: AttachmentKind;
  /** Clear name when it differs from ref, such as SMP_Calabra_Dinner_Nov2026.pdf. */
  fileName?: string;
  /** Menu or brochure is an upload-ready PDF, one menu in the file. */
  uploadReady?: boolean;
  /** They could not export an upload-ready PDF. Marketing needs to know. */
  pdfDeferred?: boolean;
}

export interface FollowUp {
  label: string;
  required: boolean;
  kind: "text" | "longtext" | "number" | "date" | "yesno" | "select";
  options?: string[];
  verbatim?: boolean;
  satisfies?: Array<"copy" | "assets" | "destination">;
}

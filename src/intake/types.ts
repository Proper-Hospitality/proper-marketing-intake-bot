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
  rushBlock?: "same_day" | "next_day" | "weekend";
  /** The date Koral or DeeDee approved. */
  rushApprovedFor?: string;
  /** Name of the approver. Kept outside the Brief question/answer lines. */
  rushApprovedBy?: string;
  rushApprovalId?: string;
}

export interface FollowUp {
  label: string;
  required: boolean;
  kind: "text" | "longtext" | "number" | "date" | "yesno" | "select";
  options?: string[];
  verbatim?: boolean;
  satisfies?: Array<"copy" | "assets" | "destination">;
}

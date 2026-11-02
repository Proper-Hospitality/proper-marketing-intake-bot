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
}

export interface FollowUp {
  label: string;
  required: boolean;
  kind: "text" | "longtext" | "number" | "date" | "yesno" | "select";
  options?: string[];
  verbatim?: boolean;
  satisfies?: Array<"copy" | "assets" | "destination">;
}

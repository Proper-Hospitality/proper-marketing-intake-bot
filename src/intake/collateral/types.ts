/** A year written on the asset, or a range the title actually covers. */
export type YearSpan =
  | { kind: "year"; year: number }
  | { kind: "range"; from: number; to: number }
  | { kind: "unknown" };

export type YearProvenance = "title" | "filename" | "text" | "user_confirmation" | "unknown";

export type CollateralKind =
  | "menu"
  | "holiday-menu"
  | "fact-sheet"
  | "brochure"
  | "floor-plan"
  | "media-book"
  | "wedding"
  | "proposal"
  | "one-pager"
  | "partnership-deck"
  | "folder-pointer"
  | "imagery"
  | "tour-script"
  | "capacity-chart";

/**
 * verified: a file whose link was checked, or whose text or image was read.
 * candidate: metadata only. Not an opened document.
 * pointer: a folder lead. Not a file list.
 */
export type CollateralTier = "verified" | "candidate" | "pointer";

export interface CollateralAsset {
  id: string;
  title: string;
  summary: string;
  kind: CollateralKind;
  /** Property codes this file actually applies to. Folder location is not this list. */
  appliesTo: string[];
  years: YearSpan;
  yearProvenance: YearProvenance;
  provenanceNote: string;
  sourceUrl: string;
  sourceKind: "canva" | "slack" | "sharepoint";
  /**
   * How the file was checked.
   * read: text or an image description is on record.
   * link_verified: a live view link was checked. The body was not copied here.
   * metadata_only: title, link, and year only. The file was not downloaded or read.
   * source_unavailable: the source returned 403. Nothing inside was listed.
   * imagery_pointer: a pictures folder, not a sales document.
   */
  retrieval?: "read" | "link_verified" | "metadata_only" | "source_unavailable" | "imagery_pointer";
  /** Omitted rows are verified. Candidates and pointers are source leads, not opened documents. */
  tier?: CollateralTier;
  /** False when the file body was not read. Filename and link only. */
  contentRead: boolean;
  outdated: boolean;
  /** False for DO NOT USE, archived, candidate-only proposals, and unread leads. */
  active: boolean;
}

export interface CollateralOffer {
  property: string;
  requestedYear?: number;
  /** Files that cover the requested year. Not shown when the year was never established. */
  current: CollateralAsset[];
  /** Older files, labeled as starting points, including superseded menus. */
  older: CollateralAsset[];
  /** Year not on the file. Never presented as the requested year. */
  unknownYear: CollateralAsset[];
  /** Metadata only. Not offered as a verified open document. */
  candidates: CollateralAsset[];
  /** Folder leads. A 403 pointer is never an indexed library. */
  pointers: CollateralAsset[];
  /** True when the offer is labeled with each file's own year because the requester skipped the year question. */
  yearUnspecified: boolean;
}

export interface CollateralQuery {
  properties: string[];
  taskType?: string;
  text: string;
  requestedYear?: number;
  yearUnspecified?: boolean;
}

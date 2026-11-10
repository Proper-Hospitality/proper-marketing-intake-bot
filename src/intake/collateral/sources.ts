import { canonicalizeProperty } from "../catalog.js";
import { COLLATERAL_CATALOG } from "./catalog.js";
import type { CollateralAsset } from "./types.js";
import { matchCollateral } from "./match.js";
import type { CollateralQuery } from "./types.js";

/** Notion page that lists where each property's sales docs live. Not fetched. */
export const SALES_COLLATERAL_SOURCE_URL = "https://app.notion.com/p/4146d40b27ff81a0be75e59df252a920";

export function salesCollateralSourceLine(): string {
  return `Full list of where each property's sales docs live: ${SALES_COLLATERAL_SOURCE_URL}`;
}

export type SalesSourceStatus =
  | "confirmed"
  | "partial"
  | "no_shared_folder"
  | "no_reply"
  | "not_asked"
  | "pending"
  | "collateral_being_updated";

export const COLLATERAL_BEING_UPDATED_LABEL = "Collateral being updated, new files coming";

export type SalesLocationType =
  | "canva_folder"
  | "sharepoint_folder"
  | "slack_files"
  | "google_drive"
  | "slack_attachments"
  | "unknown";

export interface PropertySalesSource {
  property: string;
  name: string;
  status: SalesSourceStatus;
  locationType: SalesLocationType;
  /** Links exactly as given. Not crawled. */
  links: string[];
  confirmedBy?: { name: string; when: string };
  gaps: string;
  /** Catalog file ids to name when the property has no folder. */
  catalogFileIds?: string[];
  /** Named items with no file bytes and no URL. */
  metadataOnly?: { title: string; note: string }[];
}

/**
 * Where each property's sales docs were reported to live.
 * Separate from the file catalog. Compiled Nov 10, 2026 from the Nov 4–6
 * sales-channel replies and the Aug 6 Marketing Collateral Tracker canvas.
 * These links were not opened.
 */
export const PROPERTY_SALES_SOURCES: PropertySalesSource[] = [
  {
    property: "SMP",
    name: "Santa Monica Proper",
    status: "confirmed",
    locationType: "canva_folder",
    links: [
      "https://www.canva.com/d/7Hr7IQ7p_fwF3cS",
      "https://www.canva.com/d/H8Vl4EBRTWrEh5s",
    ],
    confirmedBy: { name: "Lindsay Louise", when: "Aug 6, 2026" },
    gaps: "Elena chose the Aug 6 answer on Nov 10, 2026. The Nov #smp-sales threads had no reply. The links are example files, not a folder URL, and they cover Print Collateral only.",
  },
  {
    property: "SMB",
    name: "Shelborne Miami Beach",
    status: "confirmed",
    locationType: "sharepoint_folder",
    links: [
      "https://properhotels.sharepoint.com/:f:/s/Shelborne-SalesandMarketing/IgCRDtuFV4spTJVK2YyLe380AbtKhAZ_neq1ZsVBNfwp9rE?e=EVgjrt",
      "https://properhotels.sharepoint.com/:f:/s/Shelborne-SalesandMarketing/IgAAqDglcY6KR6CK_N-o8M5tAQJjVO99dQ3AvFnjCvXpeBE?e=2ZHNhg",
    ],
    confirmedBy: { name: "Sheila Garcia", when: "Aug 7, 2026, 6:01 AM PT" },
    gaps: "Elena chose the Aug 7 answer on Nov 10, 2026. The Nov follow-up tagged owners and added no new link. 1-RESOURCES still needed a direct look. This catalog could not list that folder (403).",
  },
  {
    property: "APS",
    name: "Avalon Palm Springs",
    status: "confirmed",
    locationType: "slack_files",
    links: ["https://properhospitalitycorp.slack.com/docs/T0ANG0N34PP/F0B9JBS0UFM"],
    confirmedBy: { name: "Abbie Nienkamp", when: "Nov 6, 2026, 10:00 AM PT" },
    gaps: "Files & Links is the #aps-sales Sales Resources canvas (F0B9JBS0UFM). Elena exported the two client-facing fact decks on Nov 10, 2026. Map & Room List and Room Capacities are on that canvas. No URLs were given for those two, and they are not file records.",
    metadataOnly: [
      { title: "Map & Room List", note: "Canva. No URL was given. It is on the #aps-sales Sales Resources canvas." },
      { title: "Room Capacities", note: "Canva. No URL was given. It is on the #aps-sales Sales Resources canvas." },
    ],
  },
  {
    property: "DTLA",
    name: "Downtown LA Proper",
    status: "confirmed",
    locationType: "sharepoint_folder",
    links: [
      "https://properhotels.sharepoint.com/sites/DowntownLAProper/Shared%20Documents/Forms/AllItems.aspx?id=%2Fsites%2FDowntownLAProper%2FShared%20Documents%2FSales%20and%20Marketing%2FDTLAP%20Collateral&viewid=d0fe99aa-89d9-419b-8040-03e95f0b81b8&ct=1737495751985&or=Teams-HL&ga=1",
      "https://properhotels.sharepoint.com/:f:/s/DowntownLAProper/IgC9wROK-fiISb72wP-7wxSIARWGQocL66ts5xu5RyL3SKs?e=2MgimY",
    ],
    confirmedBy: { name: "Stephanie Tsui", when: "Nov 5, 2026, 12:09 PM PT" },
    gaps: "Stephanie shared the DTLAP Collateral folder. Amber Duran shared the parent Sales and Marketing folder in August. The catalog has the checked files only, not every file in those folders.",
  },
  {
    property: "MYC",
    name: "Montauk Yacht Club",
    status: "pending",
    locationType: "unknown",
    links: [],
    gaps: "Pending. The Nov request was never posted in #myc-sales. An ask was drafted for Elena and has not been answered. No location and no MYC files.",
  },
  {
    property: "ABH",
    name: "Avalon Beverly Hills",
    status: "collateral_being_updated",
    locationType: "google_drive",
    links: ["https://drive.google.com/drive/folders/1smEyn8ipOL_jRFrLggnWjG1zRzVnnZ7h"],
    confirmedBy: { name: "Elena Ruiz", when: "Nov 10, 2026" },
    gaps: "Collateral being updated, new files coming. Do not suggest older Avalon Beverly Hills files. The August HERO Drive folder is imagery only, not sales collateral.",
  },
  {
    property: "TCH",
    name: "The Culver Hotel",
    status: "pending",
    locationType: "unknown",
    links: [],
    gaps: "Pending. The Nov request was never posted in #tch-sales. An ask was drafted for Elena and has not been answered. No location was given.",
  },
  {
    property: "SFP",
    name: "San Francisco Proper",
    status: "pending",
    locationType: "unknown",
    links: [],
    gaps: "Pending. No folder link yet. A follow-up with Patty and Katrina was drafted and has not been answered. Existing Slack files stay in the catalog. Group and DBR spreadsheets are not a sales-collateral location.",
  },
  {
    property: "AUP",
    name: "Austin Proper",
    status: "no_shared_folder",
    locationType: "slack_attachments",
    links: ["https://properhospitalitycorp.slack.com/archives/C0B62QUHBK4/p1793928288710819"],
    confirmedBy: { name: "Ryan Galvin", when: "Nov 5, 2026, 5:24 PM PT" },
    gaps: "Ryan said there is no centralized folder. He attached five PDFs in Slack. August Master Files were mentioned and were not shared.",
    catalogFileIds: [
      "atxp:upload:ATXP_Fact_Sheet",
      "atxp:upload:Kappo_Kappo_Events",
      "atxp:upload:Updated_Floor_Plan",
      "atxp:upload:Austin_Proper_Capacity_Chart",
      "atxp:upload:Austin_Proper_Floor_Plan",
    ],
  },
  {
    property: "HJWL",
    name: "Hotel June West LA",
    status: "confirmed",
    locationType: "sharepoint_folder",
    links: [
      "https://properhotels.sharepoint.com/:f:/s/Openings/IgA18ewHhHKLQ6SgGEVH8FQkAbrrD6hGoayOczj8t6CW1Hs?e=fBwV7I",
    ],
    confirmedBy: { name: "Jasmyne Vandyleuam", when: "Nov 5, 2026, 12:29 PM PT" },
    gaps: "Elena chose Jasmyne's Nov 5 Openings folder. The older August HJLA Sales link is not the source. People also save files on their own computers. The catalog has the checked brochure and tour script, not the whole folder.",
  },
];

export function salesSourceFor(property: string): PropertySalesSource | undefined {
  const code = canonicalizeProperty(property) ?? property;
  return PROPERTY_SALES_SOURCES.find((source) => source.property === code);
}

function linkLines(links: string[]): string {
  return links.map((link) => `  ${link}`).join("\n");
}

export function formatSalesSource(source: PropertySalesSource): string {
  if (source.status === "confirmed") {
    const who = source.confirmedBy ? `${source.confirmedBy.name} (${source.confirmedBy.when})` : "A teammate";
    const place = source.locationType === "canva_folder"
      ? `${who} said print collateral is in Canva, in Santa Monica (SMP) → Print Collateral. The links below are examples from that note, not a folder URL and not a full file list.`
      : source.locationType === "slack_files"
        ? `${who} said the files are in #aps-sales under Files & Links. That is the Sales Resources canvas, not a cataloged file.`
        : source.property === "SMB"
          ? `${who} said written collateral is in SharePoint 1-RESOURCES and imagery is in 1-PICTURES. These are folder locations. 1-RESOURCES was not listed, so this is not a file list.`
          : `${who} shared this folder. It is a location, not a cataloged file of the item you asked for.`;
    const extra = (source.metadataOnly ?? [])
      .map((item) => `• ${item.title}. ${item.note} This is not a file in the catalog.`)
      .join("\n");
    return [
      `No matching sales file is in the catalog for this request. ${place}`,
      linkLines(source.links),
      extra,
    ].filter(Boolean).join("\n");
  }
  if (source.status === "partial") {
    const who = source.confirmedBy ? `${source.confirmedBy.name} (${source.confirmedBy.when})` : "A teammate";
    return [
      `No matching sales file is in the catalog for ${source.name}. A location was mentioned, and it is only partial. It is not confirmed as the sales-doc folder. ${who} pointed to a Google Drive folder called HERO file and described it as imagery. Flyers and presentations were not shared.`,
      linkLines(source.links),
    ].join("\n");
  }
  if (source.status === "no_shared_folder") {
    const titles = (source.catalogFileIds ?? []).map((id) => COLLATERAL_CATALOG.find((asset) => asset.id === id)?.title ?? id);
    return [
      `No matching sales file is in the catalog for this request. ${source.confirmedBy?.name ?? "The team"} (${source.confirmedBy?.when ?? "date not recorded"}) said ${source.name} has no centralized folder. The files attached in Slack are already in the catalog:`,
      ...titles.map((title) => `• ${title}`),
      linkLines(source.links),
    ].join("\n");
  }
  if (source.status === "collateral_being_updated") {
    return [
      `${COLLATERAL_BEING_UPDATED_LABEL}. ${source.name} is updating its sales collateral. Check back or ask marketing. Do not use older ${source.name} files.`,
      "The Google Drive HERO folder is imagery only, not sales collateral.",
      linkLines(source.links),
    ].join("\n");
  }
  if (source.status === "pending") {
    const waiting = source.property === "SFP"
      ? " A follow-up was drafted and has not been answered."
      : " An ask was drafted and has not been answered.";
    const channel = source.property === "MYC"
      ? " The Nov request was never posted in #myc-sales."
      : source.property === "TCH"
        ? " The Nov request was never posted in #tch-sales."
        : "";
    return `No matching sales file is in the catalog for ${source.name}, and a sales-doc location is not confirmed yet.${channel}${waiting}`;
  }
  const where = source.status === "not_asked"
    ? ` The request was never posted in ${source.property === "MYC" ? "#myc-sales" : "#tch-sales"}.`
    : "";
  return `No matching sales file is in the catalog for ${source.name}, and a sales-doc location is not confirmed.${where}`;
}

export function catalogWithoutUpdatingProperties(
  properties: string[],
  catalog: CollateralAsset[] = COLLATERAL_CATALOG,
): CollateralAsset[] {
  const blocked = new Set<string>();
  for (const raw of properties) {
    const source = salesSourceFor(raw);
    if (source?.status === "collateral_being_updated") blocked.add(source.property);
  }
  if (blocked.size === 0) return catalog;
  return catalog.filter((asset) => !asset.appliesTo.some((code) => blocked.has(code)));
}

export function unmatchedSourceNote(query: CollateralQuery): string | undefined {
  const result = matchCollateral(query, catalogWithoutUpdatingProperties(query.properties));
  if (result.offer || result.needsYear) return undefined;
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const raw of query.properties) {
    const source = salesSourceFor(raw);
    if (!source || seen.has(source.property)) continue;
    seen.add(source.property);
    notes.push(formatSalesSource(source));
  }
  if (notes.length === 0) return undefined;
  return `${notes.join("\n\n")}\n\n${salesCollateralSourceLine()}`;
}

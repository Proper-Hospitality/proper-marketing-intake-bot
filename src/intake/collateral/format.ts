import type { CollateralAsset, CollateralOffer } from "./types.js";
import { isOlderThan, yearLabel } from "./match.js";

function verifiedNote(asset: CollateralAsset, note: string): string {
  const unread = asset.retrieval === "image_described"
    ? " Image-only. Page descriptions are on record. There is no text layer to search."
    : asset.contentRead
      ? ""
      : " Matched from the title and type. The design body was not copied into this catalog.";
  return `• ${asset.title} (${yearLabel(asset.years)}). ${note}${asset.summary}${unread}\n  ${asset.sourceUrl}`;
}

function candidateNote(asset: CollateralAsset, requestedYear?: number): string {
  const older = requestedYear && (isOlderThan(asset.years, requestedYear) || asset.outdated)
    ? " The filename year is older than the year you asked for."
    : "";
  const denied = asset.id === "smp:canva:DAHQtuWCJSw"
    ? " Canva denied access. The year is unknown and the content was not inspected."
    : "";
  return `• ${asset.title} (${yearLabel(asset.years)}). Source candidate. Metadata only. The file was not downloaded or read.${older}${denied} ${asset.summary}\n  ${asset.sourceUrl}`;
}

function pointerNote(asset: CollateralAsset): string {
  if (asset.retrieval === "source_unavailable") {
    return `• ${asset.title}. Folder pointer only. The source returned 403. No files were listed. This is not an indexed library. ${asset.summary}\n  ${asset.sourceUrl}`;
  }
  return `• ${asset.title}. Imagery folder only. Pictures were not downloaded. This is not a menu, fact sheet, or deck. ${asset.summary}\n  ${asset.sourceUrl}`;
}

export function formatCollateralOffer(offer: CollateralOffer): string {
  const lines: string[] = [];
  const verified = offer.current.length + offer.older.length + offer.unknownYear.length;
  const year = offer.requestedYear ? ` for ${offer.requestedYear}` : "";
  if (verified > 0) {
    lines.push(`There is already sales collateral on file${year}. These are the original links. Opening one still depends on your Canva, Slack, or SharePoint access. This list is a curated catalog, not a live folder.`);
  } else {
    lines.push("No verified file is in the catalog for this request. The leads below were not opened, and they are not a confirmed document.");
  }
  if (offer.current.length > 0) {
    const heading = offer.requestedYear
      ? `Covers ${offer.requestedYear}:`
      : "On file, with each file's own year:";
    lines.push("", heading);
    for (const asset of offer.current) {
      lines.push(verifiedNote(asset, offer.requestedYear ? `This file covers ${offer.requestedYear}. ` : ""));
    }
  }
  if (offer.older.length > 0) {
    const heading = offer.requestedYear
      ? `Older than ${offer.requestedYear} (a starting point, not the current file):`
      : "Outdated (a starting point, not the current file):";
    lines.push("", heading);
    for (const asset of offer.older) lines.push(verifiedNote(asset, ""));
  }
  if (offer.unknownYear.length > 0) {
    lines.push("", "Year not printed on the file (not labeled as any particular year):");
    for (const asset of offer.unknownYear) lines.push(verifiedNote(asset, ""));
  }
  if (offer.candidates.length > 0) {
    lines.push("", "Source candidates (not verified open documents):");
    for (const asset of offer.candidates) lines.push(candidateNote(asset, offer.requestedYear));
  }
  if (offer.pointers.length > 0) {
    lines.push("", "Folder pointers (contents not indexed):");
    for (const asset of offer.pointers) lines.push(pointerNote(asset));
  }
  lines.push("", "Reply *I'll use this* to use a link and stop here. If it's outdated or you need a new year, say so and we'll keep going on a new task.");
  return lines.join("\n");
}

export const COLLATERAL_YEAR_QUESTION = "Which year should the existing collateral be for?";

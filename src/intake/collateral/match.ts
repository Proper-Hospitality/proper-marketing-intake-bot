import { canonicalizeProperty } from "../catalog.js";
import { COLLATERAL_CATALOG } from "./catalog.js";
import type { CollateralAsset, CollateralOffer, CollateralQuery, YearSpan } from "./types.js";

export interface MatchResult {
  offer?: CollateralOffer;
  /** Ask which year before showing files, because the matches cover more than one year. */
  needsYear?: boolean;
}

const YEAR = /\b(20\d{2})\b/;

export function yearLabel(years: YearSpan): string {
  if (years.kind === "unknown") return "year not on the file";
  if (years.kind === "year") return String(years.year);
  return `${years.from}–${years.to}`;
}

export function coversYear(years: YearSpan, year: number): boolean {
  if (years.kind === "unknown") return false;
  if (years.kind === "year") return years.year === year;
  return year >= years.from && year <= years.to;
}

export function isOlderThan(years: YearSpan, year: number): boolean {
  if (years.kind === "unknown") return false;
  const end = years.kind === "year" ? years.year : years.to;
  return end < year;
}

function wantedKinds(taskType: string | undefined, text: string): Set<CollateralAsset["kind"]> {
  const kinds = new Set<CollateralAsset["kind"]>();
  const t = text.toLowerCase();
  if (/fact\s*sheet/.test(t)) kinds.add("fact-sheet");
  if (/wedding/.test(t)) kinds.add("wedding");
  if (/floor plan|charmaine/.test(t)) kinds.add("floor-plan");
  if (/brochure|meetings?\s*&?\s*events|\bm&e\b/.test(t)) kinds.add("brochure");
  if (/tour script|\btour\b/.test(t)) kinds.add("tour-script");
  if (/capacity/.test(t)) kinds.add("capacity-chart");
  if (/media book/.test(t)) kinds.add("media-book");
  if (/holiday menu/.test(t)) kinds.add("holiday-menu");
  else if (/menu|banquet|catering|cocktail|breakfast|brunch|dinner|reception/.test(t)) kinds.add("menu");
  if (/one-?pager|recovery room/.test(t)) kinds.add("one-pager");
  if (/ocean way|cabana|partnership deck/.test(t)) kinds.add("partnership-deck");
  if (/\bphotos?\b|pictures?|imagery|images\b/.test(t)) kinds.add("imagery");
  if (kinds.size > 0) return kinds;
  if (taskType === "Menu (F&B, Spa)") {
    kinds.add("menu");
    kinds.add("holiday-menu");
  } else if (taskType === "Sales Collateral") {
    kinds.add("fact-sheet");
    kinds.add("brochure");
    kinds.add("media-book");
    kinds.add("wedding");
    kinds.add("one-pager");
    kinds.add("tour-script");
    kinds.add("capacity-chart");
  } else if (taskType === "Presentation / Deck") {
    kinds.add("media-book");
  }
  return kinds;
}

function propertiesOf(query: CollateralQuery): string[] {
  const found = new Set<string>();
  for (const raw of query.properties) {
    const code = canonicalizeProperty(raw);
    if (code) found.add(code);
  }
  return [...found];
}

function tierOf(asset: CollateralAsset): "verified" | "candidate" | "pointer" {
  return asset.tier ?? "verified";
}

function sameProperty(asset: CollateralAsset, properties: string[]): boolean {
  return asset.appliesTo.some((code) => properties.includes(code));
}

function verifiedHit(asset: CollateralAsset, properties: string[], kinds: Set<CollateralAsset["kind"]>): boolean {
  if (tierOf(asset) !== "verified") return false;
  if (!asset.active && !asset.outdated) return false;
  if (!sameProperty(asset, properties)) return false;
  return kinds.has(asset.kind);
}

function candidateHit(asset: CollateralAsset, properties: string[], kinds: Set<CollateralAsset["kind"]>): boolean {
  if (tierOf(asset) !== "candidate") return false;
  if (!sameProperty(asset, properties)) return false;
  return kinds.has(asset.kind);
}

function pointerHit(
  asset: CollateralAsset,
  properties: string[],
  kinds: Set<CollateralAsset["kind"]>,
  text: string,
): boolean {
  if (tierOf(asset) !== "pointer") return false;
  if (!sameProperty(asset, properties)) return false;
  const photoOnly = kinds.size === 1 && kinds.has("imagery");
  if (asset.kind === "imagery" || asset.retrieval === "imagery_pointer") return kinds.has("imagery");
  if (asset.retrieval === "source_unavailable") {
    if (photoOnly) return false;
    return /collateral|fact\s*sheet|menu|folder|library/i.test(text)
      || kinds.has("fact-sheet")
      || kinds.has("menu")
      || kinds.has("brochure")
      || kinds.has("one-pager");
  }
  return false;
}

function distinctYearBuckets(assets: CollateralAsset[]): string[] {
  const buckets = new Set<string>();
  for (const asset of assets) buckets.add(yearLabel(asset.years));
  return [...buckets];
}

export function matchCollateral(
  query: CollateralQuery,
  catalog: CollateralAsset[] = COLLATERAL_CATALOG,
): MatchResult {
  const properties = propertiesOf(query);
  const kinds = wantedKinds(query.taskType, query.text);
  if (properties.length === 0 || kinds.size === 0) return {};
  const verified = catalog.filter((asset) => verifiedHit(asset, properties, kinds));
  const candidates = catalog.filter((asset) => candidateHit(asset, properties, kinds));
  const pointers = catalog.filter((asset) => pointerHit(asset, properties, kinds, query.text));
  if (verified.length === 0 && candidates.length === 0 && pointers.length === 0) return {};

  const requested = query.requestedYear;
  if (verified.length > 0 && !requested && !query.yearUnspecified) {
    const buckets = distinctYearBuckets(verified.filter((asset) => asset.active || asset.outdated));
    if (buckets.length > 1) return { needsYear: true };
  }

  const offer: CollateralOffer = {
    property: properties[0] ?? "",
    requestedYear: requested,
    current: [],
    older: [],
    unknownYear: [],
    candidates,
    pointers,
    yearUnspecified: !requested,
  };
  for (const asset of verified) {
    if (asset.years.kind === "unknown") {
      offer.unknownYear.push(asset);
      continue;
    }
    if (requested && coversYear(asset.years, requested) && asset.active && !asset.outdated) {
      offer.current.push(asset);
      continue;
    }
    if (requested && (isOlderThan(asset.years, requested) || asset.outdated)) {
      offer.older.push(asset);
      continue;
    }
    if (!requested && asset.outdated) {
      offer.older.push(asset);
      continue;
    }
    if (!requested && asset.active) {
      offer.current.push(asset);
    }
  }
  const shown = offer.current.length + offer.older.length + offer.unknownYear.length + candidates.length + pointers.length;
  if (shown === 0) return {};
  return { offer };
}

export function yearInText(text: string): number | undefined {
  const match = YEAR.exec(text);
  if (!match?.[1]) return undefined;
  const year = Number(match[1]);
  return year >= 2020 && year <= 2035 ? year : undefined;
}

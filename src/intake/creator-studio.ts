import { readFileSync } from "node:fs";
import type { RequestType } from "./types.js";

/**
 * Julia's Creator Studio. The link and API are not available yet.
 * When CREATOR_STUDIO_CATALOG_PATH or CREATOR_STUDIO_CATALOG_JSON is unset, lookup is a no-op.
 */

export interface CreatorStudioTemplate {
  id: string;
  name: string;
  url: string;
  requestType?: RequestType;
  taskTypes?: string[];
  keywords?: string[];
  properties?: string[];
}

export interface CreatorStudioQuery {
  requestType?: string;
  taskType?: string;
  text: string;
  properties: string[];
}

export interface CreatorStudioMatch {
  id: string;
  name: string;
  url: string;
}

export interface CreatorStudioCatalog {
  configured: boolean;
  find(query: CreatorStudioQuery): CreatorStudioMatch | null;
}

const UNCONFIGURED: CreatorStudioCatalog = {
  configured: false,
  find: () => null,
};

export function catalogFromRecords(records: CreatorStudioTemplate[]): CreatorStudioCatalog {
  return {
    configured: true,
    find(query) {
      const text = query.text.toLowerCase();
      const ranked = records
        .map((record) => ({ record, score: scoreTemplate(record, query, text) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      const best = ranked[0]?.record;
      if (!best) return null;
      return { id: best.id, name: best.name, url: best.url };
    },
  };
}

function scoreTemplate(record: CreatorStudioTemplate, query: CreatorStudioQuery, text: string): number {
  if (record.requestType && record.requestType !== query.requestType) return 0;
  if (record.taskTypes && record.taskTypes.length > 0 && !record.taskTypes.includes(query.taskType ?? "")) return 0;
  const properties = record.properties ?? [];
  if (properties.length > 0) {
    if (query.properties.length === 0) return 0;
    if (!query.properties.some((code) => properties.includes(code))) return 0;
  }
  const keywords = (record.keywords ?? []).map((word) => word.toLowerCase());
  if (keywords.length > 0 && !keywords.some((word) => text.includes(word))) return 0;
  return 1 + (properties.length > 0 ? 2 : 0) + (keywords.length > 0 ? 1 : 0);
}

export function loadCreatorStudio(
  env: NodeJS.ProcessEnv = process.env,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): CreatorStudioCatalog {
  const inline = env.CREATOR_STUDIO_CATALOG_JSON?.trim();
  const path = env.CREATOR_STUDIO_CATALOG_PATH?.trim();
  if (!inline && !path) return UNCONFIGURED;
  try {
    const raw = inline || read(path as string);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return UNCONFIGURED;
    const records = parsed.filter(isTemplate);
    return catalogFromRecords(records);
  } catch (error) {
    console.warn(JSON.stringify({
      msg: "creator_studio_catalog_unreadable",
      error: error instanceof Error ? error.message : "unknown",
    }));
    return UNCONFIGURED;
  }
}

function isTemplate(value: unknown): value is CreatorStudioTemplate {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.name === "string" && typeof record.url === "string";
}

export function formatCreatorStudioReply(match: CreatorStudioMatch): string {
  return [
    `There's already a Creator Studio template for this: *${match.name}*.`,
    match.url,
    "Use that template. I didn't create an Asana task.",
  ].join("\n");
}

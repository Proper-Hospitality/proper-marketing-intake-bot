import { ARCHIVED_TEMPLATES, CANVA_TEMPLATES, type CanvaTemplate } from "../intake/templates.js";
import type { DatasetField } from "./api.js";

export interface DatasetReportRow {
  id: string;
  name: string;
  status: "fields" | "none" | "error";
  fields: Array<{ name: string; type: string }>;
  error?: string;
}

const ARCHIVED_IDS = new Set(ARCHIVED_TEMPLATES.map((template) => template.id));

export function liveTemplates(): CanvaTemplate[] {
  return CANVA_TEMPLATES.filter((template) => !ARCHIVED_IDS.has(template.id));
}

export function classifyDataset(
  template: { id: string; name: string },
  dataset: Record<string, DatasetField> | undefined,
  error?: string,
): DatasetReportRow {
  if (error) return { id: template.id, name: template.name, status: "error", fields: [], error };
  const fields = Object.entries(dataset ?? {}).map(([name, field]) => ({ name, type: field.type }));
  return {
    id: template.id,
    name: template.name,
    status: fields.length > 0 ? "fields" : "none",
    fields,
  };
}

export function formatDatasetReport(rows: DatasetReportRow[]): string {
  const lines = [`Live templates: ${rows.length}`, ""];
  for (const row of rows) {
    if (row.status === "fields") {
      const fields = row.fields.map((field) => `${field.name} (${field.type})`).join(", ");
      lines.push(`${row.id}\t${row.name}\tfields\t${fields}`);
    } else if (row.status === "none") {
      lines.push(`${row.id}\t${row.name}\tnone\tneeds tags in the Canva editor`);
    } else {
      lines.push(`${row.id}\t${row.name}\terror\t${row.error ?? "unknown"}`);
    }
  }
  const tagged = rows.filter((row) => row.status === "fields").length;
  const untagged = rows.filter((row) => row.status === "none").length;
  lines.push("", `Tagged: ${tagged}. Untagged: ${untagged}. Errors: ${rows.length - tagged - untagged}.`);
  return lines.join("\n");
}

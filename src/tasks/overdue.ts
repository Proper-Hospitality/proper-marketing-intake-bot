import { formatDisplayDate } from "../intake/catalog.js";
import type { ListedTask } from "../store/types.js";
import { chooseAssignee, searchOpenTasks, searchWorkspaceUsers, type AsanaPerson } from "./complete.js";

export const OVERDUE_TIME_ZONE = "America/Los_Angeles";
export const TOP_OVERDUE_LINKS = 5;
const SEARCH_LIMIT = 100;

export function todayInLosAngeles(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OVERDUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Could not resolve today's date in America/Los_Angeles.");
  return `${year}-${month}-${day}`;
}

export interface OverduePersonResult {
  query: string;
  status: "counted" | "missing" | "ambiguous";
  name?: string;
  count?: number;
  atLeast?: boolean;
  people?: AsanaPerson[];
  tasks?: ListedTask[];
}

export async function overdueCountsForNames(input: {
  names: string[];
  includeTasks: boolean;
  token: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<{ today: string; results: OverduePersonResult[] }> {
  const now = input.now ?? new Date();
  const today = todayInLosAngeles(now);
  const results: OverduePersonResult[] = [];
  for (const query of input.names) {
    const people = await searchWorkspaceUsers({ token: input.token, query, fetchImpl: input.fetchImpl });
    const choice = chooseAssignee(query, people);
    if (choice.status === "none" || choice.status === "skipped") {
      results.push({ query, status: "missing" });
      continue;
    }
    if (choice.status === "ambiguous") {
      results.push({ query, status: "ambiguous", people: choice.users });
      continue;
    }
    const tasks = await searchOpenTasks({
      token: input.token,
      assigneeGid: choice.user.gid,
      filters: { dueBefore: today },
      fetchImpl: input.fetchImpl,
    });
    const oldest = [...tasks].sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"));
    results.push({
      query,
      status: "counted",
      name: choice.user.name,
      count: tasks.length,
      atLeast: tasks.length >= SEARCH_LIMIT,
      tasks: input.includeTasks ? oldest.slice(0, TOP_OVERDUE_LINKS) : undefined,
    });
  }
  return { today, results };
}

export function formatOverdueReport(today: string, results: OverduePersonResult[], includeTasks: boolean): string {
  const lines = [`Overdue means incomplete and due before ${formatDisplayDate(today)} (Pacific Time).`, ""];
  for (const result of results) {
    if (result.status === "missing") {
      lines.push(`• ${result.query} — no Asana user found`);
      continue;
    }
    if (result.status === "ambiguous") {
      const options = (result.people ?? []).map((person) => person.email ? `${person.name} (${person.email})` : person.name).join("; ");
      lines.push(`• ${result.query} — more than one person matches: ${options}. Which one?`);
      continue;
    }
    const count = result.atLeast ? `${result.count}+` : String(result.count ?? 0);
    const label = result.name && result.name.toLowerCase() !== result.query.toLowerCase() ? `${result.query} (${result.name})` : result.query;
    lines.push(`• ${label} — ${count}`);
    if (includeTasks && result.tasks && result.tasks.length > 0) {
      for (const task of result.tasks) {
        const due = task.dueOn ? formatDisplayDate(task.dueOn) : "no due date";
        lines.push(`  ${task.name} — due ${due} — ${task.url}`);
      }
    }
  }
  return lines.join("\n");
}

export function parseNameList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.flatMap((item) => typeof item === "string" ? [item] : []) : typeof value === "string" ? [value] : [];
  return raw
    .flatMap((item) => item.split(/,|&|\band\b/i))
    .map((name) => name.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").trim())
    .filter(Boolean);
}

import { AsanaRequestError, userFacingAsanaError } from "../intake/asana.js";
import { formatDisplayDate, WORKSPACE_GID } from "../intake/catalog.js";
import type { ConversationState, ListedTask } from "../store/types.js";

export type { ListedTask };

const ASANA_BASE = "https://app.asana.com/api/1.0";

/** Most tasks one Confirm click may complete. */
export const BULK_COMPLETE_CAP = 25;
const PREVIEW_COUNT = 10;

export interface AsanaPerson {
  gid: string;
  name: string;
  email?: string;
}

export interface TaskSearchFilters {
  assigneeName?: string;
  text?: string;
  projectName?: string;
  dueOn?: string;
  dueBefore?: string;
  dueAfter?: string;
}

export type AssigneeChoice =
  | { status: "skipped" }
  | { status: "none" }
  | { status: "one"; user: AsanaPerson }
  | { status: "ambiguous"; users: AsanaPerson[] };

export function chooseAssignee(query: string | undefined, candidates: AsanaPerson[]): AssigneeChoice {
  const trimmed = query?.trim() ?? "";
  if (!trimmed) return { status: "skipped" };
  const needle = trimmed.toLowerCase();
  const exact = candidates.filter((person) => person.name.trim().toLowerCase() === needle || person.email?.trim().toLowerCase() === needle);
  if (exact.length === 1) return { status: "one", user: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", users: exact };
  const parts = needle.split(/\s+/).filter(Boolean);
  const partial = candidates.filter((person) => {
    const nameParts = person.name.trim().toLowerCase().split(/\s+/);
    return parts.every((part) => nameParts.includes(part));
  });
  if (partial.length === 1) return { status: "one", user: partial[0] };
  if (partial.length > 1) return { status: "ambiguous", users: partial };
  return { status: "none" };
}

export function partitionForBulk(tasks: ListedTask[], cap = BULK_COMPLETE_CAP):
  | { status: "ready"; tasks: ListedTask[] }
  | { status: "too_many"; total: number; preview: ListedTask[] } {
  if (tasks.length > cap) {
    return { status: "too_many", total: tasks.length, preview: tasks.slice(0, PREVIEW_COUNT) };
  }
  return { status: "ready", tasks };
}

export function buildOpenTaskSearchParams(input: {
  assigneeGid?: string;
  text?: string;
  dueOn?: string;
  dueBefore?: string;
  dueAfter?: string;
}): URLSearchParams {
  const params = new URLSearchParams({
    completed: "false",
    opt_fields: "name,permalink_url,due_on,projects.name,projects.gid,assignee.name,assignee.gid",
    limit: "100",
  });
  if (input.assigneeGid) params.set("assignee.any", input.assigneeGid);
  if (input.text?.trim()) params.set("text", input.text.trim());
  if (input.dueOn) params.set("due_on", input.dueOn);
  if (input.dueBefore) params.set("due_on.before", input.dueBefore);
  if (input.dueAfter) params.set("due_on.after", input.dueAfter);
  return params;
}

export function filterListedTasks(tasks: ListedTask[], filters: TaskSearchFilters): ListedTask[] {
  const project = filters.projectName?.trim().toLowerCase();
  const text = filters.text?.trim().toLowerCase();
  return tasks.filter((task) => {
    if (project && !task.projectNames.some((name) => name.toLowerCase().includes(project))) return false;
    if (text && !task.name.toLowerCase().includes(text)) return false;
    if (filters.dueOn && task.dueOn !== filters.dueOn) return false;
    if (filters.dueBefore && (!task.dueOn || task.dueOn >= filters.dueBefore)) return false;
    if (filters.dueAfter && (!task.dueOn || task.dueOn <= filters.dueAfter)) return false;
    return true;
  });
}

export function completionComment(name: string | undefined, email: string | undefined): string {
  const who = name?.trim() || "a Slack user";
  const mail = email?.trim() || "no Slack email";
  return `Marked complete from Slack by ${who} (${mail})`;
}

export function formatTaskLines(tasks: ListedTask[]): string {
  return tasks.map((task, index) => {
    const due = task.dueOn ? formatDisplayDate(task.dueOn) : "none";
    const project = task.projectNames.length > 0 ? task.projectNames.join(", ") : "none";
    return [
      `${index + 1}. *${task.name}*`,
      `   Assignee: ${task.assigneeName || "unassigned"}`,
      `   Project: ${project}`,
      `   Due: ${due}`,
      `   ${task.url}`,
    ].join("\n");
  }).join("\n");
}

export function formatSearchMessage(tasks: ListedTask[], forCompletion: boolean): string {
  const split = partitionForBulk(tasks);
  if (tasks.length === 0) return "No incomplete tasks matched.";
  if (split.status === "too_many") {
    return [
      `I found ${split.total} incomplete tasks. I can mark at most ${BULK_COMPLETE_CAP} complete at a time, so narrow this by person, project, words in the name, or a due date.`,
      "",
      `First ${split.preview.length}:`,
      formatTaskLines(split.preview),
    ].join("\n");
  }
  const intro = forCompletion
    ? `I found ${tasks.length} incomplete task${tasks.length === 1 ? "" : "s"}. Nothing is marked complete until you click *Confirm*.`
    : `I found ${tasks.length} incomplete task${tasks.length === 1 ? "" : "s"}. Say if you want them marked complete.`;
  return [intro, "", formatTaskLines(tasks)].join("\n");
}

export function formatAmbiguousAssignees(query: string, people: AsanaPerson[]): string {
  const lines = people.map((person, index) => {
    const mail = person.email ? ` (${person.email})` : "";
    return `${index + 1}. ${person.name}${mail}`;
  });
  return [`More than one person matches "${query}". Which one?`, ...lines].join("\n");
}

export interface TaskCompletionResult {
  gid: string;
  name: string;
  url: string;
  status: "completed" | "completed_without_comment" | "failed";
  detail?: string;
}

export function formatCompletionReport(results: TaskCompletionResult[]): string {
  const done = results.filter((result) => result.status === "completed");
  const partial = results.filter((result) => result.status === "completed_without_comment");
  const failed = results.filter((result) => result.status === "failed");
  const lines: string[] = [];
  if (done.length > 0) {
    lines.push("Marked complete:");
    for (const result of done) lines.push(`• *${result.name}* — ${result.url}`);
  }
  if (partial.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Marked complete, but the comment was not added:");
    for (const result of partial) lines.push(`• *${result.name}* — ${result.detail ?? "comment failed"} — ${result.url}`);
  }
  if (failed.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Could not complete:");
    for (const result of failed) lines.push(`• *${result.name}* — ${result.detail ?? "Asana failed"}`);
  }
  if (lines.length === 0) lines.push("No tasks were marked complete.");
  return lines.join("\n");
}

export class CompletionConfirmationRequiredError extends Error {
  constructor() {
    super("Refusing to mark Asana tasks complete without an explicit confirmation.");
    this.name = "CompletionConfirmationRequiredError";
  }
}

export function stageTaskCompletion(state: ConversationState, gids?: string[]): { ok: true } | { ok: false; message: string } {
  if (!state.lastTaskSearch) {
    return { ok: false, message: "Search for tasks first. I won't mark anything complete from a guess." };
  }
  const found = state.lastTaskSearch;
  if (found.length === 0) {
    return { ok: false, message: "The last search didn't match any tasks." };
  }
  const chosen = gids && gids.length > 0 ? found.filter((task) => gids.includes(task.gid)) : found;
  if (gids && gids.length > 0) {
    const known = new Set(found.map((task) => task.gid));
    const unknown = gids.filter((gid) => !known.has(gid));
    if (unknown.length > 0) {
      return { ok: false, message: `Those tasks were not in the list I just showed: ${unknown.join(", ")}.` };
    }
  }
  const split = partitionForBulk(chosen);
  if (split.status === "too_many") {
    return {
      ok: false,
      message: `That is ${split.total} tasks. I can mark at most ${BULK_COMPLETE_CAP} complete at a time. Narrow the list first.`,
    };
  }
  if (split.tasks.length === 0) return { ok: false, message: "No tasks were selected." };
  state.pendingCompletion = split.tasks;
  state.phase = "awaiting_task_completion";
  state.confirmVersion += 1;
  state.updatedAt = new Date().toISOString();
  return { ok: true };
}

export async function searchWorkspaceUsers(input: {
  token: string;
  query: string;
  fetchImpl?: typeof fetch;
}): Promise<AsanaPerson[]> {
  const params = new URLSearchParams({
    resource_type: "user",
    query: input.query,
    count: "25",
    opt_fields: "gid,name,email",
  });
  const payload = await asanaRequest<{ data?: Array<{ gid?: string; name?: string; email?: string }> }>(
    input.fetchImpl ?? fetch,
    input.token,
    "GET",
    `/workspaces/${WORKSPACE_GID}/typeahead?${params.toString()}`,
  );
  return (payload.data ?? [])
    .filter((user) => user.gid && user.name)
    .map((user) => ({ gid: user.gid as string, name: user.name as string, email: user.email }));
}

export async function searchOpenTasks(input: {
  token: string;
  assigneeGid?: string;
  filters: TaskSearchFilters;
  fetchImpl?: typeof fetch;
}): Promise<ListedTask[]> {
  const params = buildOpenTaskSearchParams({
    assigneeGid: input.assigneeGid,
    text: input.filters.text,
    dueOn: input.filters.dueOn,
    dueBefore: input.filters.dueBefore,
    dueAfter: input.filters.dueAfter,
  });
  const payload = await asanaRequest<{ data?: RawTask[] }>(
    input.fetchImpl ?? fetch,
    input.token,
    "GET",
    `/workspaces/${WORKSPACE_GID}/tasks/search?${params.toString()}`,
  );
  const listed = (payload.data ?? []).filter((task) => task.gid && task.name).map(toListedTask);
  return filterListedTasks(listed, input.filters);
}

export async function completeTasksFromSlack(input: {
  token: string;
  tasks: ListedTask[];
  requesterName?: string;
  requesterEmail?: string;
  fetchImpl?: typeof fetch;
}): Promise<TaskCompletionResult[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const comment = completionComment(input.requesterName, input.requesterEmail);
  const results: TaskCompletionResult[] = [];
  for (const task of input.tasks) {
    try {
      await asanaRequest(fetchImpl, input.token, "PUT", `/tasks/${task.gid}`, { data: { completed: true } });
    } catch (error) {
      const detail = userFacingAsanaError(error);
      console.log(JSON.stringify({
        msg: "task_complete_from_slack_failed",
        taskGid: task.gid,
        taskName: task.name,
        requesterName: input.requesterName ?? null,
        requesterEmail: input.requesterEmail ?? null,
        error: detail,
      }));
      results.push({ gid: task.gid, name: task.name, url: task.url, status: "failed", detail });
      continue;
    }
    try {
      await asanaRequest(fetchImpl, input.token, "POST", `/tasks/${task.gid}/stories`, { data: { text: comment } });
      console.log(JSON.stringify({
        msg: "task_marked_complete_from_slack",
        taskGid: task.gid,
        taskName: task.name,
        requesterName: input.requesterName ?? null,
        requesterEmail: input.requesterEmail ?? null,
        comment,
      }));
      results.push({ gid: task.gid, name: task.name, url: task.url, status: "completed" });
    } catch (error) {
      const detail = userFacingAsanaError(error);
      console.log(JSON.stringify({
        msg: "task_complete_comment_failed",
        taskGid: task.gid,
        taskName: task.name,
        requesterName: input.requesterName ?? null,
        requesterEmail: input.requesterEmail ?? null,
        error: detail,
      }));
      results.push({ gid: task.gid, name: task.name, url: task.url, status: "completed_without_comment", detail });
    }
  }
  return results;
}

export async function finishConfirmedCompletion(input: {
  confirmed: boolean;
  version: number;
  state: ConversationState;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<{ text: string }> {
  if (!input.confirmed) throw new CompletionConfirmationRequiredError();
  const state = input.state;
  if (state.phase === "tasks_completed" && state.completionReport) return { text: state.completionReport };
  if (state.confirmVersion !== input.version) {
    return { text: "That confirm button is out of date. Search again and use the new Confirm button." };
  }
  if (state.phase !== "awaiting_task_completion" || !state.pendingCompletion || state.pendingCompletion.length === 0) {
    return { text: "There's no list of tasks waiting to be marked complete." };
  }
  if (state.pendingCompletion.length > BULK_COMPLETE_CAP) {
    return { text: `That list has ${state.pendingCompletion.length} tasks. I can mark at most ${BULK_COMPLETE_CAP} at a time.` };
  }
  const results = await completeTasksFromSlack({
    token: input.token,
    tasks: state.pendingCompletion,
    requesterName: state.completionRequesterName,
    requesterEmail: state.completionRequesterEmail,
    fetchImpl: input.fetchImpl,
  });
  const text = formatCompletionReport(results);
  state.phase = "tasks_completed";
  state.completionReport = text;
  state.pendingCompletion = undefined;
  state.updatedAt = new Date().toISOString();
  return { text };
}

interface RawTask {
  gid?: string;
  name?: string;
  permalink_url?: string;
  due_on?: string | null;
  assignee?: { gid?: string; name?: string } | null;
  projects?: Array<{ gid?: string; name?: string }>;
}

function toListedTask(task: RawTask): ListedTask {
  return {
    gid: task.gid as string,
    name: task.name as string,
    assigneeName: task.assignee?.name ?? "unassigned",
    assigneeGid: task.assignee?.gid,
    projectNames: (task.projects ?? []).map((project) => project.name).filter((name): name is string => Boolean(name)),
    dueOn: task.due_on ?? undefined,
    url: task.permalink_url ?? `https://app.asana.com/0/0/${task.gid}`,
  };
}

async function asanaRequest<T>(fetchImpl: typeof fetch, token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetchImpl(`${ASANA_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new AsanaRequestError(method, path.split("?")[0], response.status, text);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

import {
  buildIntakeFieldUpdates,
  COMPLETION_DATE_GID,
  FIELD_UPDATE_ORDER,
  PROJECT_GID,
  PROPERTY_FIELD_GID,
  REQUEST_TYPE_FIELD_GID,
  REQUESTER_EMAIL_GID,
  REQUESTER_NAME_GID,
  expectedRoutingBucket,
  ROUTING_BUCKET_FIELD_GID,
  ROUTING_BUCKET_OPTION_GIDS,
  SECTION_GID,
  TASK_TYPE_FIELDS,
  WORKSPACE_GID,
  type FieldUpdate,
} from "./catalog.js";
import { buildDescription, taskName } from "./brief.js";
import type { TemplateMatchResult } from "./templates.js";
import type { BriefDraft, RequestType } from "./types.js";

const ASANA_BASE = "https://app.asana.com/api/1.0";

export class AsanaRequestError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly responseBody: string;

  constructor(method: string, path: string, status: number, responseBody: string) {
    super(`Asana ${method} ${path} failed (${status}): ${responseBody.slice(0, 400)}`);
    this.name = "AsanaRequestError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.responseBody = responseBody;
  }
}

export function userFacingAsanaError(error: unknown): string {
  if (error instanceof AsanaRequestError) {
    try {
      const parsed = JSON.parse(error.responseBody) as { errors?: Array<{ message?: string }> };
      const message = parsed.errors?.map((item) => item.message).filter(Boolean).join("; ");
      if (message) return `Asana returned ${error.status}: ${message}`;
    } catch {
      // Body was not JSON.
    }
    return `Asana returned ${error.status} while ${error.method} ${error.path} was in progress.`;
  }
  if (error instanceof Error) return error.message;
  return "Asana failed and didn't say why.";
}

export interface CreateTaskBody {
  data: {
    name: string;
    notes: string;
    projects: string[];
    memberships: Array<{ project: string; section: string }>;
    custom_fields: Record<string, string | { date: string }>;
  };
}

export function buildCreateTaskBody(draft: BriefDraft, notes: string): CreateTaskBody {
  const customFields: Record<string, string | { date: string }> = {};
  if (draft.requesterName) customFields[REQUESTER_NAME_GID] = draft.requesterName;
  if (draft.requesterEmail) customFields[REQUESTER_EMAIL_GID] = draft.requesterEmail;
  if (draft.requestedCompletionDate) {
    customFields[COMPLETION_DATE_GID] = { date: draft.requestedCompletionDate };
  }
  const forbidden = new Set<string>([
    REQUEST_TYPE_FIELD_GID,
    PROPERTY_FIELD_GID,
    ...Object.values(TASK_TYPE_FIELDS).map((field) => field.gid),
  ]);
  for (const gid of Object.keys(customFields)) {
    if (forbidden.has(gid)) {
      throw new Error(`Create payload included intake field ${gid}. Set that in a later update.`);
    }
  }
  return {
    data: {
      name: taskName(draft),
      notes,
      projects: [PROJECT_GID],
      memberships: [{ project: PROJECT_GID, section: SECTION_GID }],
      custom_fields: customFields,
    },
  };
}

export interface AsanaCustomField {
  name?: string;
  display_value?: string | null;
  number_value?: number | null;
  text_value?: string | null;
}

export interface AsanaTask {
  gid: string;
  name?: string;
  permalink_url?: string;
  memberships?: Array<{
    project?: { gid?: string; name?: string };
    section?: { gid?: string; name?: string };
  }>;
  custom_fields?: AsanaCustomField[];
}

export interface AutomationReport {
  ok: boolean;
  statusOk: boolean;
  estimateOk: boolean;
  moved: boolean;
  multiHomed: boolean;
  fieldsStuck: boolean;
  status: string;
  estimate: string;
  sections: string[];
  projects: string[];
  summary: string;
}

export function assessAutomation(task: AsanaTask): AutomationReport {
  const fields = task.custom_fields ?? [];
  const byName = (name: string) => fields.find((field) => field.name === name);
  const status = (byName("Status in Que")?.display_value ?? "").trim();
  const estimateField = byName("Estimated time");
  const estimate = (
    estimateField?.display_value ||
    (estimateField?.number_value != null ? String(estimateField.number_value) : "") ||
    ""
  ).trim();
  const requestType = (byName("Request Type_New Intake Board")?.display_value ?? "").trim();
  const property = (byName("Property List_New Intake Board")?.display_value ?? "").trim();
  const taskTypeOk = fields.some((field) => field.name?.endsWith("Task Type") && Boolean(field.display_value));
  const sections = (task.memberships ?? []).map((membership) => membership.section?.name).filter((name): name is string => Boolean(name));
  const projects = (task.memberships ?? []).map((membership) => membership.project?.name).filter((name): name is string => Boolean(name));
  const projectGids = new Set(
    (task.memberships ?? []).map((membership) => membership.project?.gid).filter((gid): gid is string => Boolean(gid)),
  );
  const moved = sections.some((section) => /submitted via form/i.test(section));
  const multiHomed = projectGids.size > 1;
  const statusOk = status.toLowerCase() === "new request";
  const estimateOk = estimate.length > 0;
  const fieldsStuck = Boolean(requestType) && Boolean(property) && taskTypeOk;
  const ok = statusOk && estimateOk && (moved || multiHomed) && fieldsStuck;
  const gaps: string[] = [];
  if (!fieldsStuck) gaps.push("Request Type, Task Type, or Property did not stick");
  if (!statusOk) gaps.push(`Status in Que is "${status || "empty"}" instead of New Request`);
  if (!estimateOk) gaps.push("Estimated time is empty");
  if (!moved && !multiHomed) gaps.push("the task is still only in New requests - Manually Created");
  const summary = ok
    ? "Board automations ran (status, estimate, and routing)."
    : `The task exists, but the board automations don't look like they ran: ${gaps.join("; ")}. I didn't set Status, Estimated time, or Routing Bucket by hand.`;
  return { ok, statusOk, estimateOk, moved, multiHomed, fieldsStuck, status, estimate, sections, projects, summary };
}

export interface SubmitProgress {
  taskGid: string;
  fieldsApplied: number;
}

export interface SubmitResult {
  taskGid: string;
  permalinkUrl: string;
  automation: AutomationReport;
  updates: FieldUpdate[];
}

export async function createIntakeTask(input: {
  draft: BriefDraft;
  templateOffer: TemplateMatchResult | null;
  slackThread?: string;
  token: string;
  existingTaskGid?: string;
  fieldsAlreadyApplied?: number;
  fetchImpl?: typeof fetch;
  readAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (progress: SubmitProgress) => Promise<void>;
}): Promise<SubmitResult> {
  if (!input.draft.requestType || !input.draft.taskType || !input.draft.properties?.length) {
    throw new Error("Refusing to create a task without request type, task type, and property.");
  }
  const updates = buildIntakeFieldUpdates({
    requestType: input.draft.requestType,
    taskType: input.draft.taskType,
    properties: input.draft.properties,
  });
  if (updates.map((update) => update.step).join(",") !== FIELD_UPDATE_ORDER.join(",")) {
    throw new Error("Refusing to update intake fields out of order.");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const notes = buildDescription({
    draft: input.draft,
    templateOffer: input.templateOffer,
    slackThread: input.slackThread,
  });
  let taskGid = input.existingTaskGid;
  let applied = input.fieldsAlreadyApplied ?? 0;
  if (!taskGid) {
    const created = await asanaRequest<{ data: { gid: string } }>(fetchImpl, input.token, "POST", "/tasks", buildCreateTaskBody(input.draft, notes));
    taskGid = created.data.gid;
    applied = 0;
    await input.onProgress?.({ taskGid, fieldsApplied: 0 });
  }
  for (let index = applied; index < updates.length; index += 1) {
    const update = updates[index];
    await asanaRequest(fetchImpl, input.token, "PUT", `/tasks/${taskGid}`, {
      data: { custom_fields: { [update.fieldGid]: update.value } },
    });
    applied = index + 1;
    await input.onProgress?.({ taskGid, fieldsApplied: applied });
  }
  const bucket = expectedRoutingBucket(input.draft.properties ?? []);
  const bucketOption = bucket ? ROUTING_BUCKET_OPTION_GIDS[bucket] : "";
  if (bucketOption) {
    await asanaRequest(fetchImpl, input.token, "PUT", `/tasks/${taskGid}`, {
      data: { custom_fields: { [ROUTING_BUCKET_FIELD_GID]: bucketOption } },
    });
  }
  const attempts = input.readAttempts ?? 3;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let task = await readTask(fetchImpl, input.token, taskGid);
  let automation = assessAutomation(task);
  for (let attempt = 1; attempt < attempts && !automation.ok; attempt += 1) {
    await sleep(1500);
    task = await readTask(fetchImpl, input.token, taskGid);
    automation = assessAutomation(task);
  }
  return {
    taskGid,
    permalinkUrl: task.permalink_url ?? `https://app.asana.com/0/${PROJECT_GID}/${taskGid}`,
    automation,
    updates,
  };
}

export async function searchExistingTasks(input: {
  token: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<Array<{ gid: string; name: string; url?: string }>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    text: input.text,
    "projects.any": PROJECT_GID,
    opt_fields: "name,permalink_url,gid",
    limit: "5",
  });
  try {
    const payload = await asanaRequest<{ data: Array<{ gid: string; name?: string; permalink_url?: string }> }>(
      fetchImpl,
      input.token,
      "GET",
      `/workspaces/${WORKSPACE_GID}/tasks/search?${params.toString()}`,
    );
    return (payload.data ?? []).map((task) => ({
      gid: task.gid,
      name: task.name ?? "Untitled task",
      url: task.permalink_url,
    }));
  } catch (error) {
    console.error(JSON.stringify({ msg: "asana_search_failed", error: userFacingAsanaError(error) }));
    return [];
  }
}

export async function listTaskAttachmentNames(input: {
  token: string;
  taskGid: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const payload = await asanaRequest<{ data?: Array<{ name?: string }> | { name?: string } }>(
    fetchImpl,
    input.token,
    "GET",
    `/tasks/${input.taskGid}/attachments?opt_fields=name,gid`,
  );
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.map((row) => row.name?.trim() ?? "").filter(Boolean);
}

export async function uploadTaskAttachment(input: {
  token: string;
  taskGid: string;
  name: string;
  bytes: Uint8Array;
  mimetype?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const form = new FormData();
  const type = input.mimetype || "application/octet-stream";
  form.append("file", new Blob([Buffer.from(input.bytes)], { type }), input.name);
  const path = `/tasks/${input.taskGid}/attachments`;
  const response = await fetchImpl(`${ASANA_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json" },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) throw new AsanaRequestError("POST", path, response.status, text);
}

export async function addTaskFollowers(input: {
  token: string;
  taskGid: string;
  followers: string[];
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (input.followers.length === 0) return;
  const fetchImpl = input.fetchImpl ?? fetch;
  await asanaRequest(fetchImpl, input.token, "POST", `/tasks/${input.taskGid}/addFollowers`, {
    data: { followers: input.followers },
  });
}

export async function addTaskComment(input: {
  token: string;
  taskGid: string;
  text: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  await asanaRequest(fetchImpl, input.token, "POST", `/tasks/${input.taskGid}/stories`, {
    data: { text: input.text },
  });
}

export interface TaskSummary {
  gid: string;
  name: string;
  url: string;
  completed: boolean;
  dueOn?: string;
  assigneeName?: string;
  assigneeGid?: string;
  projectNames: string[];
}

export async function fetchTaskSummary(input: {
  token: string;
  taskGid: string;
  fetchImpl?: typeof fetch;
}): Promise<TaskSummary | null> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const payload = await asanaRequest<{ data: {
      gid?: string;
      name?: string;
      permalink_url?: string;
      completed?: boolean;
      due_on?: string | null;
      assignee?: { gid?: string; name?: string } | null;
      projects?: Array<{ name?: string }>;
    } }>(
      fetchImpl,
      input.token,
      "GET",
      `/tasks/${input.taskGid}?opt_fields=name,permalink_url,completed,due_on,assignee.name,assignee.gid,projects.name`,
    );
    const task = payload.data;
    if (!task?.gid || !task.name) return null;
    return {
      gid: task.gid,
      name: task.name,
      url: task.permalink_url ?? `https://app.asana.com/0/0/${task.gid}`,
      completed: task.completed === true,
      dueOn: task.due_on ?? undefined,
      assigneeName: task.assignee?.name,
      assigneeGid: task.assignee?.gid,
      projectNames: (task.projects ?? []).map((project) => project.name).filter((name): name is string => Boolean(name)),
    };
  } catch (error) {
    console.error(JSON.stringify({ msg: "asana_task_read_failed", taskGid: input.taskGid, error: userFacingAsanaError(error) }));
    return null;
  }
}

export async function updateTaskStatus(input: {
  token: string;
  taskGid: string;
  completed?: boolean;
  dueOn?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const data: { completed?: boolean; due_on?: string } = {};
  if (input.completed !== undefined) data.completed = input.completed;
  if (input.dueOn) data.due_on = input.dueOn;
  await asanaRequest(input.fetchImpl ?? fetch, input.token, "PUT", `/tasks/${input.taskGid}`, { data });
}

async function readTask(fetchImpl: typeof fetch, token: string, taskGid: string): Promise<AsanaTask> {
  const opt = [
    "permalink_url",
    "name",
    "memberships.project.name",
    "memberships.project.gid",
    "memberships.section.name",
    "custom_fields.name",
    "custom_fields.display_value",
    "custom_fields.number_value",
    "custom_fields.text_value",
  ].join(",");
  const payload = await asanaRequest<{ data: AsanaTask }>(
    fetchImpl,
    token,
    "GET",
    `/tasks/${taskGid}?opt_fields=${opt}`,
  );
  return payload.data;
}

async function asanaRequest<T>(
  fetchImpl: typeof fetch,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
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

export function taskTypeFieldGid(requestType: RequestType): string {
  return TASK_TYPE_FIELDS[requestType].gid;
}

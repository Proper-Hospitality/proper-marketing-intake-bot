import { describe, expect, it, vi } from "vitest";
import { assessAutomation, createIntakeTask, type AsanaTask } from "../src/intake/asana.js";
import { PROJECT_GID, PROPERTY_FIELD_GID, REQUEST_TYPE_FIELD_GID, SECTION_GID, TASK_TYPE_FIELDS } from "../src/intake/catalog.js";
import type { BriefDraft } from "../src/intake/types.js";

const draft: BriefDraft = {
  requesterName: "Elena Ruiz",
  requesterEmail: "elena@example.com",
  requestName: "Holiday newsletter",
  properties: ["SMP"],
  requestType: "Creative",
  taskType: "Email",
  requestedCompletionDate: "2026-12-01",
  consequenceOfDelay: "Members miss the sale.",
  approver: "DeeDee Brown",
  whereItGoesLive: "Members email",
  followUps: {
    "Audience / Distribution Plan": "Members",
    "Recommended Copy / Details": "Join us.",
  },
};

function successTask(): AsanaTask {
  return {
    gid: "T1",
    permalink_url: "https://app.asana.com/0/1/T1",
    memberships: [
      { project: { gid: PROJECT_GID, name: "New Intake Board" }, section: { name: "New requests - Submitted via Form" } },
      { project: { gid: "QUEUE", name: "New Creative Queue" }, section: { name: "New Request" } },
    ],
    custom_fields: [
      { name: "Request Type_New Intake Board", display_value: "Creative" },
      { name: "Creative Task Type", display_value: "Email" },
      { name: "Property List_New Intake Board", display_value: "SMP" },
      { name: "Status in Que", display_value: "New Request" },
      { name: "Estimated time", display_value: "4h" },
    ],
  };
}

describe("Asana client", () => {
  it("creates the task, then sets the three fields one at a time, then re-reads it", async () => {
    const calls: Array<{ method: string; url: string; body?: { data?: { custom_fields?: Record<string, unknown> } } }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url: String(url), body });
      if (method === "POST") return json({ data: { gid: "T1" } });
      if (method === "PUT") return json({ data: { gid: "T1" } });
      return json({ data: successTask() });
    });

    const result = await createIntakeTask({
      draft,
      templateOffer: null,
      token: "test-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readAttempts: 1,
    });

    expect(calls.map((call) => call.method)).toEqual(["POST", "PUT", "PUT", "PUT", "GET"]);
    expect(calls[0].url).toContain("/tasks");
    expect(calls[0].body?.data?.custom_fields).not.toHaveProperty(REQUEST_TYPE_FIELD_GID);
    expect(calls[0].body?.data?.custom_fields).not.toHaveProperty(PROPERTY_FIELD_GID);
    expect(JSON.stringify(calls[0].body)).toContain(SECTION_GID);
    expect(calls[1].body?.data?.custom_fields).toEqual({ [REQUEST_TYPE_FIELD_GID]: "1217171671548483" });
    expect(calls[2].body?.data?.custom_fields).toEqual({ [TASK_TYPE_FIELDS.Creative.gid]: "1217171671548493" });
    expect(calls[3].body?.data?.custom_fields).toEqual({ [PROPERTY_FIELD_GID]: ["1217171490189061"] });
    expect(Object.keys(calls[1].body?.data?.custom_fields ?? {})).toHaveLength(1);
    expect(Object.keys(calls[2].body?.data?.custom_fields ?? {})).toHaveLength(1);
    expect(Object.keys(calls[3].body?.data?.custom_fields ?? {})).toHaveLength(1);
    expect(result.automation.ok).toBe(true);
    expect(result.permalinkUrl).toBe("https://app.asana.com/0/1/T1");
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("stops after a failed task-type update and does not set property", async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (method === "POST") return json({ data: { gid: "T9" } });
      if (methods.filter((item) => item === "PUT").length === 1) return json({ data: { gid: "T9" } });
      return new Response(JSON.stringify({ errors: [{ message: "enum option is disabled" }] }), { status: 400 });
    });
    const progress: number[] = [];
    await expect(createIntakeTask({
      draft,
      templateOffer: null,
      token: "test-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onProgress: async (update) => {
        progress.push(update.fieldsApplied);
      },
    })).rejects.toThrow(/enum option is disabled/);
    expect(methods).toEqual(["POST", "PUT", "PUT"]);
    expect(progress).toEqual([0, 1]);
  });

  it("reports when automations did not run", () => {
    const report = assessAutomation({
      gid: "T2",
      memberships: [{ project: { gid: PROJECT_GID, name: "New Intake Board" }, section: { name: "New requests - Manually Created" } }],
      custom_fields: [
        { name: "Request Type_New Intake Board", display_value: "Creative" },
        { name: "Creative Task Type", display_value: "Email" },
        { name: "Property List_New Intake Board", display_value: "SMP" },
        { name: "Status in Que", display_value: "" },
      ],
    });
    expect(report.ok).toBe(false);
    expect(report.summary).toMatch(/didn't set Status/i);
  });

  it("resumes field updates on an existing task instead of creating another", async () => {
    const methods: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      methods.push(method);
      if (method === "GET") return json({ data: successTask() });
      return json({ data: { gid: "T1" } });
    });
    await createIntakeTask({
      draft,
      templateOffer: null,
      token: "test-token",
      existingTaskGid: "T1",
      fieldsAlreadyApplied: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      readAttempts: 1,
    });
    expect(methods).toEqual(["PUT", "PUT", "GET"]);
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

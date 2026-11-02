import { describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "../src/agent/prompt.js";
import { runIntakeTurn, type Llm, type LlmContentBlock } from "../src/agent/run.js";
import {
  BULK_COMPLETE_CAP,
  CompletionConfirmationRequiredError,
  chooseAssignee,
  completeTasksFromSlack,
  completionComment,
  finishConfirmedCompletion,
  partitionForBulk,
  searchOpenTasks,
  searchWorkspaceUsers,
  stageTaskCompletion,
} from "../src/tasks/complete.js";
import type { ListedTask } from "../src/store/types.js";
import { emptyConversation } from "../src/store/types.js";

const elena: ListedTask = {
  gid: "T1",
  name: "Holiday newsletter",
  assigneeName: "Elena Ruiz",
  assigneeGid: "U-ELENA",
  projectNames: ["New Intake Board"],
  dueOn: "2026-12-01",
  url: "https://app.asana.com/0/1/T1",
};

const deeDee: ListedTask = {
  gid: "T2",
  name: "Brand review",
  assigneeName: "DeeDee Brown",
  assigneeGid: "U-DEEDEE",
  projectNames: ["New Creative Queue"],
  dueOn: "2026-11-20",
  url: "https://app.asana.com/0/1/T2",
};

describe("task completion", () => {
  it("resolves a unique assignee and asks when the name matches more than one person", () => {
    const people = [
      { gid: "U-ELENA", name: "Elena Ruiz", email: "elena@example.com" },
      { gid: "U-ELENA-2", name: "Elena Vasquez", email: "elena.v@example.com" },
    ];
    expect(chooseAssignee("Elena Ruiz", people)).toEqual({ status: "one", user: people[0] });
    expect(chooseAssignee("elena@example.com", people)).toEqual({ status: "one", user: people[0] });
    const ambiguous = chooseAssignee("Elena", people);
    expect(ambiguous.status).toBe("ambiguous");
    if (ambiguous.status === "ambiguous") expect(ambiguous.users).toHaveLength(2);
    expect(chooseAssignee("Zelda", people).status).toBe("none");
    expect(chooseAssignee(undefined, people).status).toBe("skipped");
  });

  it("searches the named person even when that is not the Slack requester", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/typeahead")) {
        expect(href).toContain("query=DeeDee+Brown");
        expect(href).toContain("resource_type=user");
        return json({ data: [{ gid: "U-DEEDEE", name: "DeeDee Brown", email: "deedee@example.com" }] });
      }
      expect(href).toContain("assignee.any=U-DEEDEE");
      expect(href).toContain("completed=false");
      return json({
        data: [{
          gid: "T2",
          name: "Brand review",
          permalink_url: deeDee.url,
          due_on: "2026-11-20",
          assignee: { gid: "U-DEEDEE", name: "DeeDee Brown" },
          projects: [{ gid: "P2", name: "New Creative Queue" }],
        }],
      });
    });
    const people = await searchWorkspaceUsers({
      token: "token",
      query: "DeeDee Brown",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(chooseAssignee("DeeDee Brown", people)).toMatchObject({ status: "one", user: { gid: "U-DEEDEE" } });
    const tasks = await searchOpenTasks({
      token: "token",
      assigneeGid: "U-DEEDEE",
      filters: { assigneeName: "DeeDee Brown" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(tasks.map((task) => task.assigneeName)).toEqual(["DeeDee Brown"]);
    expect(tasks[0]).toMatchObject({
      projectNames: ["New Creative Queue"],
      dueOn: "2026-11-20",
      url: deeDee.url,
    });
  });

  it("refuses to complete anything without confirmation, then comments and logs each success", async () => {
    const state = emptyConversation("C1:1");
    state.lastTaskSearch = [elena, deeDee];
    state.completionRequesterName = "Sam Lee";
    state.completionRequesterEmail = "sam@example.com";
    expect(stageTaskCompletion(state).ok).toBe(true);
    expect(state.phase).toBe("awaiting_task_completion");
    await expect(finishConfirmedCompletion({
      confirmed: false,
      version: state.confirmVersion,
      state,
      token: "token",
    })).rejects.toBeInstanceOf(CompletionConfirmationRequiredError);

    const calls: Array<{ method: string; url: string; body?: { data?: { completed?: boolean; text?: string } } }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return json({ data: {} });
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
      if (typeof line === "string") logs.push(line);
    });
    const report = await finishConfirmedCompletion({
      confirmed: true,
      version: state.confirmVersion,
      state,
      token: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    spy.mockRestore();
    expect(calls.map((call) => `${call.method} ${call.url.includes("/stories") ? "comment" : "complete"}`)).toEqual([
      "PUT complete",
      "POST comment",
      "PUT complete",
      "POST comment",
    ]);
    expect(calls[0].body).toEqual({ data: { completed: true } });
    expect(calls[1].body).toEqual({ data: { text: completionComment("Sam Lee", "sam@example.com") } });
    expect(calls[1].body?.data?.text).toBe("Marked complete from Slack by Sam Lee (sam@example.com)");
    expect(report.text).toContain("Holiday newsletter");
    expect(report.text).toContain("Brand review");
    expect(logs.some((line) => line.includes("task_marked_complete_from_slack") && line.includes("sam@example.com"))).toBe(true);
    const again = await finishConfirmedCompletion({
      confirmed: true,
      version: state.confirmVersion,
      state,
      token: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(again.text).toBe(report.text);
    expect(calls).toHaveLength(4);
  });

  it("names a task that failed and a comment that failed", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/tasks/T1") && init?.method === "PUT") {
        return new Response(JSON.stringify({ errors: [{ message: "task is locked" }] }), { status: 400 });
      }
      if (href.includes("/stories")) {
        return new Response(JSON.stringify({ errors: [{ message: "comment denied" }] }), { status: 403 });
      }
      return json({ data: {} });
    });
    const results = await completeTasksFromSlack({
      token: "token",
      tasks: [elena, deeDee],
      requesterName: "Sam Lee",
      requesterEmail: "sam@example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(results.find((result) => result.gid === "T1")).toMatchObject({ status: "failed", detail: expect.stringContaining("task is locked") });
    expect(results.find((result) => result.gid === "T2")?.status).toBe("completed_without_comment");
  });

  it("caps a bulk completion at 25 and will not stage a longer list", () => {
    const many = Array.from({ length: BULK_COMPLETE_CAP + 1 }, (_, index) => ({ ...elena, gid: `T${index}`, name: `Task ${index}` }));
    expect(partitionForBulk(many).status).toBe("too_many");
    const state = emptyConversation("C1:2");
    state.lastTaskSearch = many;
    const staged = stageTaskCompletion(state);
    expect(staged.ok).toBe(false);
    expect(state.phase).not.toBe("awaiting_task_completion");
    state.lastTaskSearch = many.slice(0, BULK_COMPLETE_CAP);
    expect(stageTaskCompletion(state).ok).toBe(true);
    expect(state.pendingCompletion).toHaveLength(BULK_COMPLETE_CAP);
  });

  it("lists someone else's tasks and waits for Confirm before calling Asana to complete them", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/typeahead")) {
        return json({ data: [{ gid: "U-DEEDEE", name: "DeeDee Brown", email: "deedee@example.com" }] });
      }
      if (href.includes("/tasks/search")) {
        return json({
          data: [{
            gid: "T2",
            name: "Brand review",
            permalink_url: deeDee.url,
            due_on: "2026-11-20",
            assignee: { gid: "U-DEEDEE", name: "DeeDee Brown" },
            projects: [{ name: "New Creative Queue" }],
          }],
        });
      }
      throw new Error(`unexpected ${href}`);
    });
    const llm: Llm = {
      async complete() {
        const blocks: LlmContentBlock[] = [
          { type: "tool_use", id: "search", name: "search_open_tasks", input: { assigneeName: "DeeDee Brown" } },
          { type: "tool_use", id: "done", name: "complete_tasks", input: {} },
        ];
        return { content: blocks };
      },
    };
    const state = emptyConversation("C1:3");
    const reply = await runIntakeTurn({
      state,
      userText: "Find any task that has DeeDee Brown as assignee and mark them complete",
      slackUser: { id: "U1", name: "Sam Lee", email: "sam@example.com" },
      llm,
      asanaToken: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(reply.confirm?.kind).toBe("complete");
    expect(reply.text).toContain("DeeDee Brown");
    expect(reply.text).toContain("New Creative Queue");
    expect(reply.text).toContain("Nov 20, 2026");
    expect(reply.text).toContain(deeDee.url);
    expect(reply.text).toContain("Confirm");
    expect(fetchImpl.mock.calls.every((call) => !String(call[0]).includes("/stories"))).toBe(true);
    expect(state.phase).toBe("awaiting_task_completion");
    const prompt = buildSystemPrompt(state, { name: "Sam Lee", email: "sam@example.com" });
    expect(prompt).toContain("assigned to anyone");
    expect(prompt).toContain("Never say you created");
  });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

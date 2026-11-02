import { describe, expect, it, vi } from "vitest";
import { runIntakeTurn, type Llm } from "../src/agent/run.js";
import { formatOverdueReport, overdueCountsForNames, parseNameList, todayInLosAngeles } from "../src/tasks/overdue.js";
import { emptyConversation } from "../src/store/types.js";

const now = new Date("2026-11-02T18:00:00Z");

describe("overdue counts", () => {
  it("uses the Pacific calendar date, including just before midnight", () => {
    expect(todayInLosAngeles(now)).toBe("2026-11-02");
    expect(todayInLosAngeles(new Date("2026-11-02T07:30:00Z"))).toBe("2026-11-01");
  });

  it("splits a spoken list of first names", () => {
    expect(parseNameList("savannah, kat, korel, deedee, talley, jack and kinsey")).toEqual([
      "savannah",
      "kat",
      "korel",
      "deedee",
      "talley",
      "jack",
      "kinsey",
    ]);
  });

  it("counts each person, asks when a name is ambiguous, and says when nobody matches", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      calls.push(href);
      if (href.includes("/typeahead")) {
        const query = new URL(href).searchParams.get("query");
        if (query === "savannah") return json({ data: [{ gid: "U-SAV", name: "Savannah Lee", email: "savannah@example.com" }] });
        if (query === "kat") return json({ data: [] });
        if (query === "korel") {
          return json({
            data: [
              { gid: "U-K1", name: "Korel Ames", email: "korel.a@example.com" },
              { gid: "U-K2", name: "Korel Brooks", email: "korel.b@example.com" },
            ],
          });
        }
        return json({ data: [] });
      }
      expect(href).toContain("assignee.any=U-SAV");
      expect(href).toContain("completed=false");
      expect(href).toContain("due_on.before=2026-11-02");
      return json({
        data: [
          task("T-new", "Still open", "2026-11-02"),
          task("T-old", "Past due flyer", "2026-10-15"),
          task("T-older", "Menu upload", "2026-09-01"),
        ],
      });
    });
    const report = await overdueCountsForNames({
      names: ["savannah", "kat", "korel"],
      includeTasks: false,
      token: "token",
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(report.results.map((result) => result.status)).toEqual(["counted", "missing", "ambiguous"]);
    expect(report.results[0]).toMatchObject({ name: "Savannah Lee", count: 2 });
    expect(calls.filter((href) => href.includes("/tasks/search"))).toHaveLength(1);
    const text = formatOverdueReport(report.today, report.results, false);
    expect(text).toContain("savannah (Savannah Lee) — 2");
    expect(text).toContain("kat — no Asana user found");
    expect(text).toContain("korel — more than one person matches: Korel Ames (korel.a@example.com); Korel Brooks (korel.b@example.com)");
    expect(text).not.toContain("http");
  });

  it("adds the oldest overdue links only when asked", async () => {
    const fetchImpl = vi.fn(async () => json({
      data: [
        task("T-mid", "Mid", "2026-10-20"),
        task("T-old", "Oldest", "2026-09-01"),
      ],
    }));
    const report = await overdueCountsForNames({
      names: ["deedee"],
      includeTasks: true,
      token: "token",
      now,
      fetchImpl: async (url) => {
        if (String(url).includes("/typeahead")) {
          return json({ data: [{ gid: "U-DEE", name: "DeeDee Brown", email: "deedee@example.com" }] });
        }
        return fetchImpl();
      },
    });
    const text = formatOverdueReport(report.today, report.results, true);
    expect(text).toContain("deedee (DeeDee Brown) — 2");
    expect(text.indexOf("Oldest")).toBeLessThan(text.indexOf("Mid"));
    expect(text).toContain("https://app.asana.com/0/1/T-old");
    expect(text).not.toContain("Confirm");
  });

  it("answers from Slack without a confirm button", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/typeahead")) {
        const query = new URL(href).searchParams.get("query");
        if (query === "kat") return json({ data: [] });
        return json({ data: [{ gid: "U-SAV", name: "Savannah Lee" }] });
      }
      return json({ data: [task("T-old", "Past due flyer", "2026-10-15")] });
    });
    const llm: Llm = {
      async complete() {
        return {
          content: [{
            type: "tool_use",
            id: "overdue",
            name: "count_overdue_tasks",
            input: { names: ["savannah", "kat"], includeTasks: false },
          }],
        };
      },
    };
    const reply = await runIntakeTurn({
      state: emptyConversation("C1:overdue"),
      userText: "how many overdue tasks do savannah and kat have",
      slackUser: { id: "U1", name: "Sam Lee", email: "sam@example.com" },
      llm,
      asanaToken: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      today: now,
    });
    expect(reply.confirm).toBeUndefined();
    expect(reply.text).toContain("savannah (Savannah Lee) — 1");
    expect(reply.text).toContain("kat — no Asana user found");
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes("/stories"))).toBe(false);
  });
});

function task(gid: string, name: string, due: string) {
  return {
    gid,
    name,
    permalink_url: `https://app.asana.com/0/1/${gid}`,
    due_on: due,
    assignee: { gid: "U", name: "Someone" },
    projects: [{ name: "New Intake Board" }],
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

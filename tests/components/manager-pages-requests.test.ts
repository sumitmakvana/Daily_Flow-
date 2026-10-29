// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Static guards for the request volume of /team-capacity, /executive and /eod (too large to render in a unit test).
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
const exec = read("src/routes/_authenticated/executive.tsx");
const cap = read("src/routes/_authenticated/team-capacity.tsx");
const eod = read("src/routes/_authenticated/eod.tsx");
const win = read("src/lib/task-window.ts");

describe("route guards share the role read", () => {
  it.each([
    ["executive", exec],
    ["team-capacity", cap],
  ])("%s does not query user_roles directly in beforeLoad", (_n, src) => {
    const guard = src.slice(src.indexOf("beforeLoad"), src.indexOf("component:"));
    expect(guard).toContain("getRolesShared(");
    expect(guard).not.toMatch(/from\("user_roles"\)/);
    // The guard still redirects a non-manager.
    expect(guard).toMatch(/redirect\(\{ to: "\/today" \}\)/);
  });
});

describe("/executive", () => {
  it("refreshes its task list by changed rows, not by re-reading the whole table", () => {
    expect(exec).toContain("loadAllTasksSlim<Task>(");
    expect(exec).toMatch(/EXEC_TASK_COLS[\s\S]{0,400}updated_at/);
  });

  it("keeps the summary fresh for 30s so a remount or tab return does not re-run the server function", () => {
    const q = exec.slice(exec.indexOf('queryKey: ["exec-summary", range'), exec.indexOf("useRealtimeRefresh("));
    expect(q).toMatch(/staleTime:\s*30_000/);
    expect(q).toMatch(/refetchOnWindowFocus:\s*false/);
  });
});

describe("/eod", () => {
  it("a task event refreshes only the tasks, and bursts collapse into one follow-up refresh", () => {
    expect(eod).toMatch(/useRealtimeTasks\(refreshTasks,/);
    expect(eod).toContain("st.again");
  });

  it("the member drawer is re-read only when that member's rows changed", () => {
    expect(eod).toMatch(/\[selectedMemberId, drawerSig\]/);
    expect(eod).not.toMatch(/\[selectedMemberId, tasks\]/);
  });
});

describe("worklog columns", () => {
  it("embeds only the worklog columns the UI reads (not select *)", () => {
    expect(win).toMatch(/WITH_WORKLOGS = `\*, worklogs:task_worklogs\(\$\{WORKLOG_COLS\}\)`/);
    expect(win).not.toContain('worklogs:task_worklogs(*)"');
    for (const c of ["work_date", "system_hours", "logged_hours", "updated_at"]) expect(win).toMatch(new RegExp(`WORKLOG_COLS = "[^"]*${c}`));
  });
});

describe("serverFn 2e23b265 (getMyDay) has no caller on these pages", () => {
  it.each([
    ["executive", exec],
    ["team-capacity", cap],
    ["eod", eod],
  ])("%s does not import it", (_n, src) => {
    expect(src).not.toMatch(/getMyDay|my-day\.functions/);
  });
});

describe("/eod reads a window, not the whole table", () => {
  it("every task read goes through the EOD window filter", () => {
    expect(eod).toMatch(/windowApply\s*=\s*\(q: any\) => q\.or\(eodWindowFilter\(todayISO\(\)\)\)/);
    expect((eod.match(/loadAllTasksSlim<Task>\(TASK_EOD_COLS, tasksRef\.current, fullAt, windowApply\)/g) ?? []).length).toBe(2);
  });

  it("the all-time completed total is loaded only for the table view", () => {
    expect(eod).toMatch(/if \(viewMode === "table"\) void loadOlderCompleted\(\)/);
  });

  it("the workload snapshot still reads every task (it stores all-time totals)", () => {
    expect(eod).toMatch(/loadAllTasksSlim<Task>\(TASK_EOD_COLS, undefined, \{ current: 0 \}\)/);
  });

  it("the window keeps open tasks and today's completions", () => {
    expect(win).toContain("status.neq.Completed,completed_at.gte.");
    expect(win).toContain("completed_at.lt.");
  });
});

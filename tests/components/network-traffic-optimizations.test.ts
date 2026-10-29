// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deltaSince } from "@/lib/task-window";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");

describe("deltaSince", () => {
  it("is the newest updated_at minus the overlap", () => {
    const since = deltaSince([{ updated_at: "2026-10-28T10:00:00.000Z" }, { updated_at: "2026-10-28T10:05:00.000Z" }, { updated_at: null }], 60_000);
    expect(since).toBe("2026-10-28T10:04:00.000Z");
  });
  it("is null with nothing to anchor on, which forces a full load", () => {
    expect(deltaSince([])).toBeNull();
    expect(deltaSince([{ updated_at: null }, { updated_at: "not a date" }])).toBeNull();
  });
});

describe("Tasks page: server-side pagination", () => {
  const src = read("src/routes/_authenticated/tasks.tsx");
  it("reads ONE page from the API (rows + exact total), never the whole table", () => {
    expect(src).toContain("fetchTaskListPage(paramsRef.current");
    expect(src).not.toMatch(/fetchRecentTasks|fetchOlderCompleted|loadAllTasksSlim/);
    expect(src).not.toMatch(/from("tasks")s*.select("*")s*;?s*$/m);
  });
  it("applies filters, search, sort and counters on the server, with a member always scoped to their own tasks", () => {
    expect(src).toContain("fetchSidebarCounts(tab, scope)");
    expect(src).toContain("fetchTabCounts(paramsRef.current)");
    expect(src).toContain("fetchHeaderCounts(scope)");
    expect(src).toContain('const tab: TaskTab = canSeeAll ? (activeTab as TaskTab) : "my_tasks"');
    expect(src).toContain("const canSeeAll = isManager");
  });
  it("a realtime event reads the same page's ids + updated_at and full rows only for what changed", () => {
    expect(src).toContain("fetchTaskListSignature(p)");
    expect(src).toContain("fetchTasksByIds(changed, todayStr())");
    expect(src).toContain("setCountsTick((n) => n + 1)"); // counters refresh once things settle
  });
  it("offers 25 and 50 per page (the server caps a page at 50)", () => {
    expect(src).toContain('<SelectItem value="25">');
    expect(src).toContain('<SelectItem value="50">');
    expect(src).not.toContain('<SelectItem value="100">');
  });
});

describe("Node server compression and caching", () => {
  const src = read("runner.js");
  it("compresses static text and streams compression for dynamic responses", () => {
    expect(src).toMatch(/brotliCompress/);
    expect(src).toMatch(/Content-Encoding/);
    expect(src).toMatch(/Z_SYNC_FLUSH/); // streamed HTML keeps flushing
  });
  it("caches hashed assets forever and revalidates everything else", () => {
    expect(src).toMatch(/public, max-age=31536000, immutable/);
    expect(src).toMatch(/pathname\.startsWith\('\/assets\/'\)/);
    expect(src).toMatch(/'no-cache'/);
    expect(src).toMatch(/if-none-match/);
  });
});

describe("Calendar, Time Tracking and Team Capacity", () => {
  it("calendar grid reads light rows; the day panel and detail modal read full rows on demand", () => {
    const src = read("src/routes/_authenticated/calendar.tsx");
    expect(src).toContain("loadAllTasksSlim<Task>(TASK_CALENDAR_COLS"); // light rows; changed rows only after the first read
    expect(src).toContain('ranged.eq("assigned_to", user.id)'); // a member only sees their own tasks
    expect(src).not.toMatch(/from\("tasks"\)\s*\.select\("\*"\)\s*\.or\(/);
    expect(src).toMatch(/\.select\("\*"\)\s*\.in\("id", dayIds\.split\(","\)\)/); // day panel
    expect(src).toMatch(/\.select\("\*"\)\s*\.eq\("id", id\)/); // detail modal
    expect(src).toMatch(/task=\{full\}/); // cards render the full row
  });
  it("time tracking selects named task and worklog columns", () => {
    const src = read("src/routes/_authenticated/time-tracking.tsx");
    expect(src).toMatch(/select\(TASK_TIMESHEET_COLS\)/);
    expect(src).toMatch(/select\(WORKLOG_TIMESHEET_COLS\)/);
    expect(src).not.toMatch(/from\("tasks"\)(?: as any)?\)?\.select\("\*"\)/);
  });
  it("team capacity refreshes its window by delta, with a periodic full load", () => {
    const src = read("src/routes/_authenticated/team-capacity.tsx");
    expect(src).toMatch(/refreshRecentTasks\(prev as TaskWithWorklogs\[\], cutoff, todayLocal\)/);
    expect(src).toMatch(/Date\.now\(\) - f\.at < 5 \* 60_000/);
  });
});

describe("My Day and Planning", () => {
  it("My Day reads the recent window of the user's tasks and counts the all-time completed total", () => {
    const src = read("src/routes/_authenticated/my-day.tsx");
    expect(src).toContain("fetchMyTasksWithWorklogs(user.id, toLocalISO(new Date()), windowCutoff())");
    expect(src).toContain("countMyCompleted(user.id)");
    expect(src).toContain("completedTotal={completedTotal}");
    expect(read("src/components/MyTodayWorkSummaryCard.tsx")).toContain("completedTotal ?? effectiveTasks.filter");
  });
  it("Planning reads named columns and reads full rows only for the selected tasks", () => {
    const src = read("src/routes/_authenticated/planning.tsx");
    expect(src).toContain("select(TASK_PLANNING_COLS)");
    expect(src).not.toContain('from("tasks").select("*")');
    expect(src.split("await selectedFull()").length - 1).toBe(3);
  });
});

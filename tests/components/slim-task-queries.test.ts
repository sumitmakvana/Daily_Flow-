// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TASK_COMMAND_COLS, TASK_DASHBOARD_COLS, TASK_DASHBOARD_DETAIL_COLS, TASK_WORKLOAD_COLS } from "@/lib/task-columns";
import { RISK_SELECT_COLS } from "@/services/risks.functions";

// Manager pages used to download `tasks?select=*` (~1.2 MB). They keep every row (their totals cover
// historical tasks) but fetch only the columns they read.

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
const cols = (s: string) => s.split(",").map((c) => c.trim());

describe("column lists", () => {
  it("workload maths columns cover what computeToday / isOverdue read", () => {
    for (const c of ["id", "assigned_to", "status", "due_date", "planned_hours", "actual_hours"]) {
      expect(cols(TASK_WORKLOAD_COLS)).toContain(c);
    }
  });
  it("command and dashboard add only what they display", () => {
    expect(cols(TASK_COMMAND_COLS)).toEqual(expect.arrayContaining([...cols(TASK_WORKLOAD_COLS), "sla_due_at"]));
    expect(cols(TASK_DASHBOARD_COLS)).toEqual(
      expect.arrayContaining([...cols(TASK_WORKLOAD_COLS), "priority", "completed_at"]),
    );
    // code / name / blocker details are read only for the rows the two lists show
    expect(cols(TASK_DASHBOARD_COLS)).not.toContain("task_name");
    expect(cols(TASK_DASHBOARD_DETAIL_COLS)).toEqual(["id", "task_code", "task_name", "blocked_at", "blocker_reason"]);
    expect(read("src/routes/_authenticated/dashboard.tsx")).toMatch(/\.in\("id", listIds\.slice/);
    for (const l of [TASK_WORKLOAD_COLS, TASK_COMMAND_COLS, TASK_DASHBOARD_COLS]) expect(l).not.toContain("*");
  });
});

describe("pages do not read the whole tasks row", () => {
  const PAGES = ["workload", "dashboard", "heatmap", "command", "analytics", "planning-suggestions"];
  it.each(PAGES)("%s selects named columns", (p) => {
    expect(read(`src/routes/_authenticated/${p}.tsx`)).not.toMatch(/from\("tasks"\)\s*\.select\("\*"\)/);
  });
  it("planning-suggestions downloads no tasks at all", () => {
    expect(read("src/routes/_authenticated/planning-suggestions.tsx")).not.toMatch(/from\("tasks"\)/);
  });
  it("analytics reads only completed_at, within the displayed 14 days", () => {
    expect(read("src/routes/_authenticated/analytics.tsx")).toMatch(/from\("tasks"\)\.select\("completed_at"\)\.gte\("completed_at"/);
  });
  it("calendar fetches tasks by the visible due_date range (+ today), and only tasks on a realtime event", () => {
    const src = read("src/routes/_authenticated/calendar.tsx");
    expect(src).toMatch(/\.or\(`and\(due_date\.gte\.\$\{from\},due_date\.lte\.\$\{to\}\),due_date\.eq\.\$\{today\}`\)/);
    expect(src).toMatch(/useRealtimeTasks\(loadTasks,/);
  });
  it("EOD loads a member's full history only when the drawer opens", () => {
    const src = read("src/routes/_authenticated/eod.tsx");
    expect(src).toMatch(/loadAllTasksSlim<Task>\(TASK_EOD_COLS/); // light rows, changed rows only after the first load
    expect(src).toMatch(/\.eq\("assigned_to", selectedMemberId\)/);
    expect(src).toMatch(/tasks=\{drawerTasks\.rows\}/);
  });
  it("Smart planning's Accept re-reads the full task by id instead of trusting the slim list", () => {
    const src = read("src/components/SuggestionsPanel.tsx");
    expect(src).toMatch(/from\("tasks"\)\.select\("\*"\)\.eq\("id", s\.task_id\)/);
    expect(src).not.toMatch(/tasks\.find\(/);
  });
});

describe("schema mismatches that made Command and Heatmap fail", () => {
  // Verified against public.risk_events / public.daily_workload_snapshot in the local DB.
  it("risk_events query only names real columns", () => {
    const names = cols(RISK_SELECT_COLS.replace(/\s+/g, " "));
    for (const bad of ["work_item_id", "user_id", "team_id", "reason", "evidence"]) expect(names).not.toContain(bad);
    expect(names).toEqual(expect.arrayContaining(["entity_type", "entity_id", "summary", "payload", "detected_at"]));
  });
  it("heatmap snapshot query reads created_at, not the non-existent captured_at", () => {
    const src = read("src/services/workload.functions.ts");
    expect(src).not.toMatch(/captured_at/);
    expect(src).toMatch(/completed_count, created_at/);
  });
});

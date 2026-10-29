// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Static guards for /executive request volume (the page is too large to render in a unit test).
// The "eod-widget-tasks" query reads every task (status / overdue / per-person counts). It used to
// refetch on every window focus and remount (staleTime 5s) and was never invalidated by realtime.
// It must now be kept fresh by task events instead, so the dashboard counts stay accurate.

const src = fs.readFileSync(path.resolve(__dirname, "../../src/routes/_authenticated/executive.tsx"), "utf8");
// The query's key is built from the range/scope (taskWindowKey); its options run to the member-drawer query.
const widgetQuery = src.slice(src.indexOf("queryKey: taskWindowKey"), src.indexOf('queryKey: ["exec-member-tasks"'));
// The columns live in a constant so the first load and the changed-rows refresh read the same ones.
const execCols = /const EXEC_TASK_COLS =\s*"([^"]+)"/.exec(src)?.[1] ?? "";

describe("/executive eod-widget-tasks", () => {
  it("does not refetch the whole table on every window focus", () => {
    expect(widgetQuery).toMatch(/refetchOnWindowFocus:\s*false/);
  });

  it("has a staleTime of at least a minute (was 5s)", () => {
    const m = /staleTime:\s*([\d_]+)/.exec(widgetQuery);
    expect(m).not.toBeNull();
    expect(Number(m![1].replace(/_/g, ""))).toBeGreaterThanOrEqual(60_000);
  });

  it("is invalidated by the same realtime task events that refresh the summary (so counts stay live)", () => {
    const hook = /useRealtimeRefresh\(\s*\["tasks"\][\s\S]*?"exec-summary-rt"/.exec(src)?.[0] ?? "";
    expect(hook).toContain('queryKey: ["exec-summary"]');
    expect(hook).toContain('queryKey: ["eod-widget-tasks"]');
  });

  it("still selects every column the dashboard reads, so its numbers are computed from the same data", () => {
    for (const col of ["status", "due_date", "assigned_to", "completed_at", "priority", "project_name", "blocker_reason", "planned_hours", "actual_hours", "created_at"]) {
      expect(execCols).toContain(col);
    }
  });

  it("refreshes only the changed rows after the first load (same helper as the EOD board)", () => {
    expect(widgetQuery).toContain("loadAllTasksSlim");
    expect(execCols).toContain("updated_at");
  });

  it("does not download carry_forward_count (nothing on this page reads it)", () => {
    expect(execCols).not.toContain("carry_forward_count");
    expect(src).not.toMatch(/\.carry_forward_count/);
  });

  it("reads a range/scope window, not the whole table, and waits for people + scope", () => {
    expect(widgetQuery).toContain("execRangeFilter(range)");
    expect(widgetQuery).toMatch(/enabled:\s*eodProfilesReady && !!scope/);
  });

  it("loads a member's full task and check-in history only while their drawer is open", () => {
    expect(src).toMatch(/queryKey: \["exec-member-tasks", selectedMemberId\],\s*enabled: !!selectedMemberId/);
    expect(src).toMatch(/queryKey: \["exec-member-checkins", selectedMemberId\],\s*enabled: !!selectedMemberId/);
    expect(src).not.toMatch(/queryKey: \["exec-checkins"\]/);
  });

  it("the global report reads every task once, on click", () => {
    expect(src).toMatch(/handleExportGlobalReport = async \(\) => \{[\s\S]{0,300}loadAllTasksSlim<Task>\(EXEC_TASK_COLS, undefined/);
  });
});

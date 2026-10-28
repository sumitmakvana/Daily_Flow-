// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Static guards for /executive request volume (the page is too large to render in a unit test).
// The "eod-widget-tasks" query reads every task (status / overdue / per-person counts). It used to
// refetch on every window focus and remount (staleTime 5s) and was never invalidated by realtime.
// It must now be kept fresh by task events instead, so the dashboard counts stay accurate.

const src = fs.readFileSync(path.resolve(__dirname, "../../src/routes/_authenticated/executive.tsx"), "utf8");
const widgetQuery = src.slice(src.indexOf('queryKey: ["eod-widget-tasks"]'), src.indexOf('queryKey: ["eod-widget-profiles"]'));

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
      expect(widgetQuery).toContain(col);
    }
  });

  it("does not download carry_forward_count (nothing on this page reads it)", () => {
    expect(widgetQuery).not.toContain("carry_forward_count");
    expect(src).not.toMatch(/\.carry_forward_count/);
  });
});

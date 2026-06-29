import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { workloadService, utilTone } from "@/services/workload";
import type { Task } from "@/lib/types";

const t = (o: Partial<Task>): Task => ({
  id: o.id ?? Math.random().toString(),
  task_code: "T", task_name: "x", status: "To Do", priority: "Medium", version: 1,
  done: false, carry_forward_count: 0, assigned_to: "u1", reviewer: null,
  due_date: null, blocker_reason: null, blocked_at: null, planned_hours: 4, actual_hours: 1,
  created_at: "", updated_at: "", ...o,
} as Task);

describe("services/workload.computeToday", () => {
  it("skips tasks without assignee", () => {
    const m = workloadService.computeToday([t({ assigned_to: null })]);
    expect(m.size).toBe(0);
  });

  it("aggregates planned/actual", () => {
    const m = workloadService.computeToday([
      t({ planned_hours: 3, actual_hours: 1 }),
      t({ planned_hours: 2, actual_hours: 2 }),
    ]);
    expect(m.get("u1")?.planned_hours).toBe(5);
    expect(m.get("u1")?.actual_hours).toBe(3);
    expect(m.get("u1")?.active).toBe(2);
  });

  it("counts completed separately, not in active", () => {
    const m = workloadService.computeToday([t({ status: "Completed", planned_hours: 5 })]);
    expect(m.get("u1")?.completed).toBe(1);
    expect(m.get("u1")?.active).toBe(0);
    expect(m.get("u1")?.planned_hours).toBe(0);
  });

  it("counts blocked", () => {
    const m = workloadService.computeToday([t({ status: "Blocked" })]);
    expect(m.get("u1")?.blocked).toBe(1);
  });

  it("counts delayed (overdue)", () => {
    const m = workloadService.computeToday([t({ due_date: "2020-01-01" })]);
    expect(m.get("u1")?.delayed).toBe(1);
  });
});

describe("services/workload.snapshotToday", () => {
  beforeEach(() => mockSupabase.reset());

  it("returns 0 when empty", async () => {
    expect(await workloadService.snapshotToday([])).toBe(0);
  });

  it("upserts rows", async () => {
    mockSupabase.queueResponse("upsert", { data: null });
    const n = await workloadService.snapshotToday([t({})]);
    expect(n).toBe(1);
    expect(mockSupabase.calls.ops[0].op).toBe("upsert");
  });

  it("throws on db error", async () => {
    mockSupabase.queueResponse("upsert", { error: { message: "x" } });
    await expect(workloadService.snapshotToday([t({})])).rejects.toBeTruthy();
  });
});

describe("services/workload.last7Days", () => {
  beforeEach(() => mockSupabase.reset());
  it("fetches and returns rows", async () => {
    mockSupabase.queueResponse("select", { data: [{ user_id: "u" }] });
    expect(await workloadService.last7Days()).toHaveLength(1);
  });
  it("returns [] when null", async () => {
    mockSupabase.queueResponse("select", { data: null });
    expect(await workloadService.last7Days()).toEqual([]);
  });
});

describe("utilTone", () => {
  it("Under", () => expect(utilTone(1).label).toBe("Under"));
  it("Balanced", () => expect(utilTone(5).label).toBe("Balanced"));
  it("Near limit", () => expect(utilTone(8.5).label).toBe("Near limit"));
  it("Overloaded", () => expect(utilTone(20).label).toBe("Overloaded"));
});

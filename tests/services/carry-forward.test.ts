import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { carryForwardService } from "@/services/carry-forward";
import type { Task } from "@/lib/types";

const t = (o: Partial<Task> = {}): Task => ({
  id: "t1", task_code: "T", task_name: "x", status: "To Do", priority: "Medium",
  version: 1, done: false, carry_forward_count: 0, assigned_to: "u1", reviewer: null,
  due_date: "2026-05-20", blocker_reason: null, blocked_at: null, planned_hours: 0,
  actual_hours: 0, created_at: "", updated_at: "", ...o,
} as Task);

describe("services/carry-forward", () => {
  beforeEach(() => mockSupabase.reset());

  it("carry calls atomic RPC", async () => {
    mockSupabase.queueResponse("rpc", { data: null });
    await carryForwardService.carry(t(), "u1", "2026-05-25", "manager");
    expect(mockSupabase.calls.rpc[0]).toBe("carry_task_forward");
  });

  it("carry uses default target when toDate omitted", async () => {
    mockSupabase.queueResponse("rpc", { data: null });
    await carryForwardService.carry(t({ due_date: null }), "u1");
    // no throw = ok
  });

  it("carry throws when RPC errors", async () => {
    mockSupabase.queueResponse("rpc", { error: { message: "x" } });
    await expect(carryForwardService.carry(t(), "u1")).rejects.toBeTruthy();
  });

  it("carryAllOverdue tracks ok and failed counts", async () => {
    mockSupabase.queueResponse("select", { data: [t({ id: "a" }), t({ id: "b" })] });
    mockSupabase.queueResponse("rpc", { data: null });
    mockSupabase.queueResponse("rpc", { error: { message: "conflict" } });
    const res = await carryForwardService.carryAllOverdue("u1", "u1");
    expect(res.attempted).toBe(2);
    expect(res.ok).toBe(1);
    expect(res.failed).toBe(1);
  });

  it("carryAllOverdue returns zeros with no rows", async () => {
    mockSupabase.queueResponse("select", { data: null });
    const res = await carryForwardService.carryAllOverdue("u1", "u1");
    expect(res).toEqual({ attempted: 0, ok: 0, failed: 0, errors: [] });
  });

  it("listForTask returns rows", async () => {
    mockSupabase.queueResponse("select", { data: [{ id: "1" }] });
    expect(await carryForwardService.listForTask("t1")).toHaveLength(1);
  });

  it("listForTask returns [] when null", async () => {
    mockSupabase.queueResponse("select", { data: null });
    expect(await carryForwardService.listForTask("t1")).toEqual([]);
  });
});

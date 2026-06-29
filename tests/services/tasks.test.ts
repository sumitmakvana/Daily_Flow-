import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { tasksService, TaskConflictError } from "@/services/tasks";
import type { Task } from "@/lib/types";

const baseTask = (overrides: Partial<Task> = {}): Task => ({
  id: "t1",
  task_code: "T-0001",
  task_name: "X",
  status: "To Do",
  priority: "Medium",
  version: 1,
  done: false,
  carry_forward_count: 0,
  assigned_to: "u1",
  reviewer: null,
  due_date: null,
  blocker_reason: null,
  blocked_at: null,
  planned_hours: 0,
  actual_hours: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
} as Task);

describe("services/tasks", () => {
  beforeEach(() => mockSupabase.reset());

  it("create inserts and returns the row", async () => {
    mockSupabase.queueResponse("insert", { data: baseTask({ id: "new" }) });
    const t = await tasksService.create({ task_name: "X" }, "user1");
    expect(t.id).toBe("new");
    expect(mockSupabase.calls.ops[0].op).toBe("insert");
  });

  it("create throws on error", async () => {
    mockSupabase.queueResponse("insert", { error: { message: "boom" } });
    await expect(tasksService.create({}, "u")).rejects.toBeTruthy();
  });

  it("update returns updated row", async () => {
    mockSupabase.queueResponse("update", { data: baseTask({ version: 2 }) });
    const t = await tasksService.update(baseTask(), { task_name: "y" }, "u1");
    expect(t.version).toBe(2);
  });

  it("update throws TaskConflictError when row missing", async () => {
    mockSupabase.queueResponse("update", { data: null });
    await expect(tasksService.update(baseTask(), {}, "u1")).rejects.toBeInstanceOf(TaskConflictError);
  });

  it("update throws on db error", async () => {
    mockSupabase.queueResponse("update", { error: { message: "x" } });
    await expect(tasksService.update(baseTask(), {}, "u1")).rejects.toBeTruthy();
  });

  it("setStatus -> Completed sets done/completed_at", async () => {
    mockSupabase.queueResponse("update", { data: baseTask({ status: "Completed", done: true }) });
    const t = await tasksService.setStatus(baseTask(), "Completed", "u1");
    expect(t.status).toBe("Completed");
    expect(mockSupabase.calls.ops[0].payload).toMatchObject({ status: "Completed", done: true });
  });

  it("setStatus -> non-Completed resets done", async () => {
    mockSupabase.queueResponse("update", { data: baseTask({ status: "In Progress" }) });
    await tasksService.setStatus(baseTask({ status: "Completed", done: true }), "In Progress", "u1");
    expect(mockSupabase.calls.ops[0].payload).toMatchObject({ done: false, completed_at: null });
  });

  it("setStatus -> Blocked sets blocker_reason and notifies reviewer via RPC", async () => {
    mockSupabase.queueResponse("update", { data: baseTask({ status: "Blocked" }) });
    mockSupabase.queueResponse("rpc", { data: null });
    await tasksService.setStatus(baseTask({ reviewer: "rev1" }), "Blocked", "u1", { blocker_reason: "API down" });
    expect(mockSupabase.calls.rpc).toContain("notify_task_blocked");
    const updatePayload = mockSupabase.calls.ops[0].payload as Record<string, unknown>;
    expect(updatePayload.blocker_reason).toBe("API down");
  });

  it("setStatus blocked uses task.blocker_reason fallback", async () => {
    mockSupabase.queueResponse("update", { data: baseTask({ status: "Blocked" }) });
    await tasksService.setStatus(baseTask({ blocker_reason: "old" }), "Blocked", "u1");
    expect((mockSupabase.calls.ops[0].payload as Record<string, unknown>).blocker_reason).toBe("old");
  });

  it("setStatus blocked default reason", async () => {
    mockSupabase.queueResponse("update", { data: baseTask({ status: "Blocked" }) });
    await tasksService.setStatus(baseTask(), "Blocked", "u1");
    expect((mockSupabase.calls.ops[0].payload as Record<string, unknown>).blocker_reason).toBe("Blocked");
  });

  it("setStatus leaving Blocked clears blocked_at", async () => {
    mockSupabase.queueResponse("update", { data: baseTask({ status: "In Progress" }) });
    await tasksService.setStatus(baseTask({ status: "Blocked" }), "In Progress", "u1");
    expect((mockSupabase.calls.ops[0].payload as Record<string, unknown>).blocked_at).toBeNull();
  });

  it("transfer updates assignee + sends notification", async () => {
    mockSupabase.queueResponse("update", { data: baseTask({ assigned_to: "u2" }) });
    mockSupabase.queueResponse("insert", { data: null });
    await tasksService.transfer(baseTask(), "u2", "mgr");
    expect(mockSupabase.calls.from).toContain("notifications");
  });

  it("setPriority", async () => {
    mockSupabase.queueResponse("update", { data: baseTask({ priority: "High" }) });
    const t = await tasksService.setPriority(baseTask(), "High", "u1");
    expect(t.priority).toBe("High");
  });

  it("addComment inserts history", async () => {
    mockSupabase.queueResponse("insert", { data: null });
    await tasksService.addComment("t1", "hi", "u1", "To Do");
    expect(mockSupabase.calls.ops[0].op).toBe("insert");
    expect(mockSupabase.calls.from[0]).toBe("task_history");
  });

  it("addComment throws on db error", async () => {
    mockSupabase.queueResponse("insert", { error: { message: "x" } });
    await expect(tasksService.addComment("t1", "c", "u1", "To Do")).rejects.toBeTruthy();
  });

  it("delete removes a row", async () => {
    mockSupabase.queueResponse("delete", { data: null });
    await tasksService.delete("t1");
    expect(mockSupabase.calls.ops[0].op).toBe("delete");
  });

  it("delete throws on db error", async () => {
    mockSupabase.queueResponse("delete", { error: { message: "x" } });
    await expect(tasksService.delete("t1")).rejects.toBeTruthy();
  });

  it("TaskConflictError name", () => {
    expect(new TaskConflictError().name).toBe("TaskConflictError");
  });
});

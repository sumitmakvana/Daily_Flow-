import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import type { Task } from "@/lib/types";

const { submit } = vi.hoisted(() => ({
  submit: vi.fn(async (..._args: unknown[]) => ({
    id: "rev1",
    submitted_at: "2026-10-26T10:00:00Z",
  })),
}));
vi.mock("@/services/reviews", () => ({ reviewsService: { submit } }));

import { tasksService } from "@/services/tasks";

const baseTask = (o: Partial<Task> = {}): Task =>
  ({
    id: "t1",
    task_code: "T-1",
    task_name: "X",
    status: "In Progress",
    priority: "Medium",
    version: 4,
    done: false,
    carry_forward_count: 0,
    assigned_to: "u1",
    reviewer: "rev",
    due_date: null,
    blocker_reason: null,
    blocked_at: null,
    planned_hours: 0,
    actual_hours: 0,
    started_at: "2026-10-26T08:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...o,
  }) as Task;

describe("tasksService.setStatus with the In Review workflow", () => {
  beforeEach(() => {
    mockSupabase.reset();
    submit.mockClear();
  });

  it("routes 'In Review' through the review submission, not a plain update", async () => {
    const t = await tasksService.setStatus(baseTask(), "In Review", "u1");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(mockSupabase.calls.ops.filter((o) => o.op === "update")).toHaveLength(0);
    expect(t).toMatchObject({
      status: "In Review",
      started_at: null,
      review_submitted_at: "2026-10-26T10:00:00Z",
      version: 5,
    });
  });

  it("passes the assignee's logged hours through to the review submission", async () => {
    await tasksService.setStatus(baseTask(), "In Review", "u1", { logged_hours: 2.5 });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), {
      loggedHours: 2.5,
    });
  });

  it("without hours the submission carries none (the database then blocks approval until logged)", async () => {
    await tasksService.setStatus(baseTask(), "In Review", "u1");
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), {
      loggedHours: undefined,
    });
  });

  it("is a no-op when the task is already In Review", async () => {
    const task = baseTask({ status: "In Review" });
    expect(await tasksService.setStatus(task, "In Review", "u1")).toBe(task);
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["Completed", "In Progress", "To Do", "Blocked", "On Hold"] as const)(
    "refuses a plain move from In Review to %s",
    async (to) => {
      await expect(
        tasksService.setStatus(baseTask({ status: "In Review" }), to, "u1"),
      ).rejects.toThrow(/approve it or request changes/);
      expect(mockSupabase.calls.ops.filter((o) => o.op === "update")).toHaveLength(0);
    },
  );

  it("does not resume the timer on a task in review", async () => {
    await expect(tasksService.resumeTimer(baseTask({ status: "In Review" }), "u1")).rejects.toThrow(
      /in review/,
    );
    expect(mockSupabase.calls.ops.filter((o) => o.op === "update")).toHaveLength(0);
  });

  it("leaves the other transitions untouched", async () => {
    mockSupabase.queueResponse("update", { data: baseTask({ status: "Completed", done: true }) });
    await tasksService.setStatus(baseTask(), "Completed", "u1");
    expect(submit).not.toHaveBeenCalled();
    expect(mockSupabase.calls.ops[0].payload).toMatchObject({ status: "Completed", done: true });
  });
});

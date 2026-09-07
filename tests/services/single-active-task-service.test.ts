import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { tasksService } from "@/services/tasks";
import type { Task } from "@/lib/types";

const mockActiveTask: Task = {
  id: "t1",
  task_code: "TSK-101",
  task_name: "Active Task 1",
  status: "In Progress",
  priority: "High",
  assigned_to: "u1",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  system_hours: 1,
  actual_hours: 1,
  planned_hours: 4,
  done: false,
  version: 1,
};

const mockNewTask: Task = {
  id: "t2",
  task_code: "TSK-102",
  task_name: "New Task 2",
  status: "To Do",
  priority: "Medium",
  assigned_to: "u1",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  started_at: null,
  system_hours: 0,
  actual_hours: 0,
  planned_hours: 4,
  done: false,
  version: 1,
};

describe("tasksService Single Active Task", () => {
  beforeEach(() => {
    mockSupabase.reset();
  });

  it("getActiveTask returns single active task for user", async () => {
    mockSupabase.queueResponse("select", { data: mockActiveTask });

    const active = await tasksService.getActiveTask("u1");
    expect(active).not.toBeNull();
    expect(active?.id).toBe("t1");
    expect(active?.status).toBe("In Progress");
  });

  it("getActiveTask returns null when no active task exists", async () => {
    mockSupabase.queueResponse("select", { data: null });

    const active = await tasksService.getActiveTask("u1");
    expect(active).toBeNull();
  });

  it("switchActiveTask pauses old active task and starts new task", async () => {
    vi.spyOn(tasksService, "update")
      .mockResolvedValueOnce({ ...mockActiveTask, status: "To Do", started_at: null })
      .mockResolvedValueOnce({ ...mockNewTask, status: "In Progress", started_at: new Date().toISOString() });

    const result = await tasksService.switchActiveTask(mockActiveTask, mockNewTask, "u1");

    expect(result.stoppedTask.status).toBe("To Do");
    expect(result.stoppedTask.started_at).toBeNull();
    expect(result.startedTask.status).toBe("In Progress");
    expect(result.startedTask.started_at).not.toBeNull();
  });
});

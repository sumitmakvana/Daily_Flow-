import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActiveTaskConflictModal } from "@/components/ActiveTaskConflictModal";
import type { Task } from "@/lib/types";

const mockActiveTask: Task = {
  id: "t1",
  task_code: "TSK-101",
  task_name: "Active Fix Bug Task",
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
  task_name: "New Feature Task",
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

describe("ActiveTaskConflictModal", () => {
  it("renders conflict message and task details", () => {
    render(
      <ActiveTaskConflictModal
        open={true}
        onOpenChange={() => {}}
        activeTask={mockActiveTask}
        newTask={mockNewTask}
        onConfirm={() => {}}
      />
    );

    expect(screen.getByText("Task Already in Progress")).toBeInTheDocument();
    expect(screen.getByText("TSK-101")).toBeInTheDocument();
    expect(screen.getByText("Active Fix Bug Task")).toBeInTheDocument();
    expect(
      screen.getByText("You already have a task in progress. Stop the current task and start this new task?")
    ).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Stop & Start New Task")).toBeInTheDocument();
  });

  it("calls onConfirm when Stop & Start New Task button is clicked", async () => {
    const handleConfirm = vi.fn();
    const handleOpenChange = vi.fn();

    render(
      <ActiveTaskConflictModal
        open={true}
        onOpenChange={handleOpenChange}
        activeTask={mockActiveTask}
        newTask={mockNewTask}
        onConfirm={handleConfirm}
      />
    );

    const confirmBtn = screen.getByText("Stop & Start New Task");
    fireEvent.click(confirmBtn);

    expect(handleConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(handleOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("calls onOpenChange(false) when Cancel button is clicked", () => {
    const handleOpenChange = vi.fn();

    render(
      <ActiveTaskConflictModal
        open={true}
        onOpenChange={handleOpenChange}
        activeTask={mockActiveTask}
        newTask={mockNewTask}
        onConfirm={() => {}}
      />
    );

    const cancelBtn = screen.getByText("Cancel");
    fireEvent.click(cancelBtn);

    expect(handleOpenChange).toHaveBeenCalledWith(false);
  });
});

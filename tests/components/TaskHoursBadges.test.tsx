import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TaskHoursBadges } from "@/components/TaskHoursBadges";

describe("TaskHoursBadges Multi-Session Time Tracking", () => {
  it("renders simple timer badge when only cumulative system hours exist", () => {
    render(<TaskHoursBadges task={{ system_hours: 4.5, planned_hours: 4 }} />);
    expect(screen.getByText("Plan:")).toBeInTheDocument();
    expect(screen.getByText("4h")).toBeInTheDocument();
    expect(screen.getByText("Timer:")).toBeInTheDocument();
    expect(screen.getByText("4h 30m")).toBeInTheDocument();
  });

  it("renders dual Today and Total timer badges when today_system_hours < system_hours", () => {
    render(
      <TaskHoursBadges
        task={{
          planned_hours: 4,
          system_hours: 8.8,
          today_system_hours: 4.8,
          worklogs: [
            {
              id: "w1",
              task_id: "t1",
              user_id: "u1",
              work_date: "2026-09-08",
              system_hours: 4.0,
              logged_hours: 4.0,
              created_at: "",
              updated_at: "",
            },
            {
              id: "w2",
              task_id: "t1",
              user_id: "u1",
              work_date: "2026-09-09",
              system_hours: 4.8,
              logged_hours: 0,
              created_at: "",
              updated_at: "",
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Today:")).toBeInTheDocument();
    expect(screen.getByText("4h 48m")).toBeInTheDocument();
    expect(screen.getByText(/Total:\s*8h 48m/)).toBeInTheDocument();
  });
});

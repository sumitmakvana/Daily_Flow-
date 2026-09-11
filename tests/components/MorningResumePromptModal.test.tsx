import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MorningResumePromptModal } from "@/components/MorningResumePromptModal";

// Mock hooks and router
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "user1", user_metadata: { display_name: "Meet Patel" } },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/services/tasks", () => ({
  tasksService: {
    getActiveTask: vi.fn().mockResolvedValue(null),
    queryTasks: vi.fn().mockResolvedValue([
      {
        id: "t102",
        task_code: "TSK-102",
        task_name: "V2: Column Wise in UI, CSV Lat Long",
        status: "To Do",
        system_hours: 4.0,
        project_name: "MTC Recon",
      },
    ]),
    setStatus: vi.fn().mockResolvedValue({}),
  },
}));

describe("MorningResumePromptModal Component", () => {
  it("renders morning resume prompt for paused task when user logs in", async () => {
    localStorage.clear();
    render(<MorningResumePromptModal />);

    expect(await screen.findByText(/Unified Morning Digest/i)).toBeInTheDocument();
    expect(screen.getByText("TSK-102")).toBeInTheDocument();
    expect(screen.getByText("V2: Column Wise in UI, CSV Lat Long")).toBeInTheDocument();
    expect(screen.getByText("Yesterday's Paused")).toBeInTheDocument();
    expect(screen.getByText(/Start Counter Now/i)).toBeInTheDocument();
  });
});

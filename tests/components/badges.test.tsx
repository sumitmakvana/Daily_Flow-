import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { mockSupabase } from "../mocks/supabase";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityBadge } from "@/components/PriorityBadge";
import { RiskBadge } from "@/components/RiskBadge";
import { PredictiveBadge } from "@/components/PredictiveBadge";
import { CarryForwardBadge } from "@/components/CarryForwardBadge";
import { BlockerAge } from "@/components/BlockerAge";
import { CapacityBar } from "@/components/CapacityBar";
import { StreakChip } from "@/components/StreakChip";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1" }, isManager: false, isAdmin: false, roles: [], loading: false, session: null }),
}));

describe("simple badges", () => {
  beforeEach(() => mockSupabase.reset());

  it("StatusBadge renders status text", () => {
    render(<StatusBadge status="In Progress" />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("PriorityBadge renders priority", () => {
    render(<PriorityBadge priority="High" />);
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("RiskBadge renders kind label", () => {
    const { container } = render(<RiskBadge risk={{ kind: "overdue", severity: "high" }} />);
    expect(container.textContent?.length).toBeGreaterThan(0);
  });

  it("PredictiveBadge returns null when score is 0", () => {
    const { container } = render(<PredictiveBadge score={0} reasons={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("PredictiveBadge renders for nonzero score", () => {
    render(<PredictiveBadge score={0.9} reasons={["overdue"]} />);
    expect(screen.getByText(/risk/i)).toBeInTheDocument();
  });

  it("CarryForwardBadge null when 0", () => {
    const { container } = render(<CarryForwardBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("CarryForwardBadge danger at >=3", () => {
    render(<CarryForwardBadge count={3} />);
    expect(screen.getByText("CF×3")).toBeInTheDocument();
  });

  it("CarryForwardBadge mild at 1", () => {
    render(<CarryForwardBadge count={1} />);
    expect(screen.getByText("CF×1")).toBeInTheDocument();
  });

  it("BlockerAge null when no date", () => {
    const { container } = render(<BlockerAge blockedAt={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("BlockerAge today", () => {
    render(<BlockerAge blockedAt={new Date().toISOString()} />);
    expect(screen.getByText("today")).toBeInTheDocument();
  });

  it("BlockerAge 1d and 3d+", () => {
    const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000 - 60_000).toISOString();
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
    const { rerender } = render(<BlockerAge blockedAt={oneDayAgo} />);
    expect(screen.getByText("1d")).toBeInTheDocument();
    rerender(<BlockerAge blockedAt={fourDaysAgo} />);
    expect(screen.getByText("4d")).toBeInTheDocument();
  });

  it("CapacityBar under and over capacity", () => {
    const { rerender } = render(<CapacityBar planned={10} actual={5} />);
    expect(screen.getByText("5.0h / 10.0h")).toBeInTheDocument();
    rerender(<CapacityBar planned={60} actual={50} capacity={40} />);
    expect(screen.getByText("40h cap")).toBeInTheDocument();
  });

  it("StreakChip hides for streak < 2", async () => {
    mockSupabase.queueResponse("select", { data: { current_streak: 1 } });
    const { container } = render(<StreakChip />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("StreakChip shows for streak >= 2", async () => {
    mockSupabase.queueResponse("select", { data: { current_streak: 5 } });
    render(<StreakChip />);
    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
  });
});

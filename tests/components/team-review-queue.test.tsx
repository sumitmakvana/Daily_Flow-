import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Task } from "@/lib/types";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => undefined,
  },
}));
vi.mock("@/services/reviews", () => ({
  reviewsService: { listForTask: vi.fn(async () => []) },
}));

import { TeamReviewQueue } from "@/components/review/TeamReviewQueue";
import { sortByWaiting } from "@/lib/review";

const profiles = [
  { id: "a1", display_name: "Alice" },
  { id: "a2", display_name: "Bob" },
  { id: "m1", display_name: "Max" },
];

const task = (id: string, minutesAgo: number, over: Partial<Task> = {}) =>
  ({
    id,
    task_code: `T-${id}`,
    task_name: `Task ${id}`,
    status: "In Review",
    priority: "Medium",
    assigned_to: "a1",
    reviewer: "m1",
    project_name: "Apollo",
    due_date: "2026-10-30",
    actual_hours: 2,
    system_hours: 2,
    review_submitted_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  }) as Task;

const wrap = (ui: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("sortByWaiting", () => {
  it("puts the review that has waited longest first and does not mutate the input", () => {
    const input = [task("new", 5), task("old", 3000), task("mid", 90)];
    expect(sortByWaiting(input).map((t) => t.id)).toEqual(["old", "mid", "new"]);
    expect(input.map((t) => t.id)).toEqual(["new", "old", "mid"]);
  });
});

describe("TeamReviewQueue", () => {
  const base = { profiles, userId: "m1", isManager: true, onChanged: () => {} };

  it("lists every task in review, longest-waiting first, with assignee and project", () => {
    wrap(
      <TeamReviewQueue {...base} tasks={[task("b", 5), task("a", 3000, { assigned_to: "a2" })]} />,
    );
    const items = screen
      .getAllByRole("listitem")
      .filter((li) => li.closest("ul")?.getAttribute("aria-label") === "Tasks in review");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText(/Task a/)).toBeInTheDocument();
    expect(within(items[0]).getByText(/Bob · Apollo/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/Task b/)).toBeInTheDocument();
  });

  it("shows the review panel (logged hours, timer, waiting) for each task", () => {
    wrap(<TeamReviewQueue {...base} tasks={[task("a", 30)]} />);
    expect(screen.getByRole("region", { name: "Review status" })).toBeInTheDocument();
    expect(screen.getByText("Logged", { selector: "dt" })).toBeInTheDocument();
    expect(screen.getByText("Timer gap", { selector: "dt" })).toBeInTheDocument();
  });

  it("opens the task when its title is clicked", () => {
    const onOpenTask = vi.fn();
    wrap(<TeamReviewQueue {...base} tasks={[task("a", 30)]} onOpenTask={onOpenTask} />);
    fireEvent.click(screen.getByRole("button", { name: /Task a/ }));
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("says so when nothing is in review for the current filters", () => {
    wrap(<TeamReviewQueue {...base} tasks={[]} />);
    expect(screen.getByText(/No tasks are in review/)).toBeInTheDocument();
  });
});

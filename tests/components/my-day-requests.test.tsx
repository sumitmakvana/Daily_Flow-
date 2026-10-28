import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import type { Task } from "@/lib/types";

// Regression for /my-day request volume:
//  - the page must not download the whole task_worklogs table (worklogs come embedded with MY tasks);
//  - the Summary card must not fetch its own second copy of my tasks when the page supplies them.

const taskQueries = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      taskQueries(table);
      const chain: any = { select: () => chain, eq: () => Promise.resolve({ data: [], error: null }) };
      return chain;
    },
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a> }));
vi.mock("recharts", () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Box, LineChart: Box, Line: Box, BarChart: Box, Bar: Box,
    AreaChart: Box, Area: Box, XAxis: Box, YAxis: Box, Tooltip: Box, CartesianGrid: Box,
  };
});

import { MyTodayWorkSummaryCard } from "@/components/MyTodayWorkSummaryCard";

const t = (id: string, over: Partial<Task> = {}) =>
  ({ id, task_name: `Task ${id}`, status: "Completed", assigned_to: "u1", completed_at: new Date().toISOString(), actual_hours: 2, planned_hours: 2, ...over }) as unknown as Task;

beforeEach(() => taskQueries.mockClear());

describe("MyTodayWorkSummaryCard request volume", () => {
  it("makes NO task request when the page supplies the user's tasks", async () => {
    await act(async () => {
      render(<MyTodayWorkSummaryCard allTasks={[t("a"), t("b")]} />);
    });
    expect(taskQueries).not.toHaveBeenCalled();
  });

  it("still works standalone (no allTasks): exactly one request for the user's tasks", async () => {
    await act(async () => {
      render(<MyTodayWorkSummaryCard />);
    });
    expect(taskQueries).toHaveBeenCalledTimes(1);
    expect(taskQueries).toHaveBeenCalledWith("tasks");
  });

  it("uses the supplied tasks for the numbers (same data it used to fetch itself)", async () => {
    const { container } = render(<MyTodayWorkSummaryCard allTasks={[t("a"), t("b")]} />);
    await act(async () => {});
    // Two tasks completed today were supplied; the card must reflect them.
    expect(container.textContent).toMatch(/2/);
  });
});

describe("/my-day page source guards (static)", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../src/routes/_authenticated/my-day.tsx"), "utf8");

  it("never queries the whole task_worklogs table", () => {
    expect(src).not.toMatch(/from\(\s*["']task_worklogs["']\s*\)/);
  });

  it("loads my tasks through the embedded-worklogs helper", () => {
    expect(src).toMatch(/fetchMyTasksWithWorklogs\(/);
  });

  it("passes the loaded tasks to the Summary card instead of letting it refetch", () => {
    expect(src).toMatch(/<MyTodayWorkSummaryCard[\s\S]*?allTasks=\{tasks\}/);
  });

  it("the two realtime callbacks join an in-flight My Day refetch instead of cancelling and restarting it", () => {
    // (Refetches after explicit user actions keep the default, so they are not counted here.)
    const joined = src.match(/q\.refetch\(\{ cancelRefetch: false \}\)/g) ?? [];
    expect(joined).toHaveLength(2);
  });
});

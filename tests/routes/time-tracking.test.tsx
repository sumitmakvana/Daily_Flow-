import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock TanStack Router
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: any) => config.component,
}));

// Mock Supabase
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => Promise.resolve({ data: [{ id: "u1", display_name: "Sumit Makwana" }] }) };
      }
      if (table === "projects") {
        return { select: () => Promise.resolve({ data: [{ id: "p1", name: "Operon" }] }) };
      }
      if (table === "tasks") {
        return {
          select: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    id: "t1",
                    task_code: "TSK-101",
                    task_name: "Time Tracking Feature",
                    planned_hours: 4,
                    actual_hours: 4,
                    system_hours: 4.5,
                    assigned_to: "u1",
                    project_name: "Operon",
                    status: "In Progress",
                  },
                ],
              }),
          }),
        };
      }
      if (table === "task_worklogs") {
        return {
          select: () => ({
            order: () =>
              Promise.resolve({
                data: [
                  {
                    id: "w1",
                    task_id: "t1",
                    user_id: "u1",
                    work_date: "2026-09-09",
                    system_hours: 4.5,
                    logged_hours: 4.0,
                  },
                ],
              }),
          }),
        };
      }
      return { select: () => Promise.resolve({ data: [] }) };
    },
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    isManager: true,
    isAdmin: true,
  }),
}));

import { Route } from "@/routes/_authenticated/time-tracking";

describe("TimeTracking Page Route", () => {
  it("renders Time Tracking header, KPI cards, and worklogs table", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const Component = (Route as any);
    render(
      <QueryClientProvider client={queryClient}>
        <Component />
      </QueryClientProvider>
    );

    expect(await screen.findByText(/Time Tracking & Worklogs/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-Tracked Timer/i)).toBeInTheDocument();
    expect(screen.getByText(/User Logged Hours/i)).toBeInTheDocument();
    expect(screen.getByText(/Planned Target Hours/i)).toBeInTheDocument();
    expect(screen.getByText("Export CSV")).toBeInTheDocument();
  });
});

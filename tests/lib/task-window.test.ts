import { describe, expect, it, vi, beforeEach } from "vitest";

const calls: Array<[string, ...unknown[]]> = [];
let result: { data: unknown; error: unknown; count?: number } = { data: [], error: null };

// A chainable, awaitable stand-in for the PostgREST query builder that records every call.
const builder: any = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (prop === "then") return (res: (v: unknown) => void) => res(result);
      return (...args: unknown[]) => {
        calls.push([prop, ...args]);
        return builder;
      };
    },
  },
);

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => (calls.push(["from", t]), builder) } }));

import {
  countOlderCompleted,
  fetchMyTasksWithWorklogs,
  fetchOlderCompleted,
  fetchOlderCompletedSummary,
  fetchRecentTasks,
  mergeById,
  olderCompletedFilter,
  recentFilter,
  windowCutoff,
  withTodayHours,
} from "@/lib/task-window";

beforeEach(() => {
  calls.length = 0;
  result = { data: [], error: null };
});

describe("window filters", () => {
  it("windowCutoff is N days back as YYYY-MM-DD", () => {
    expect(windowCutoff(14, new Date("2026-10-27T10:00:00Z"))).toBe("2026-10-13");
    expect(windowCutoff(0, new Date("2026-10-27T10:00:00Z"))).toBe("2026-10-27");
  });

  it("recent and older filters are exact complements for Completed rows", () => {
    expect(recentFilter("2026-10-13")).toBe(
      "status.neq.Completed,completed_at.gte.2026-10-13,and(completed_at.is.null,updated_at.gte.2026-10-13)",
    );
    expect(olderCompletedFilter("2026-10-13")).toBe(
      "completed_at.lt.2026-10-13,and(completed_at.is.null,updated_at.lt.2026-10-13)",
    );
  });
});

describe("withTodayHours", () => {
  it("sums only today's system hours and keeps all worklogs", () => {
    const rows = [
      { id: "a", worklogs: [{ work_date: "2026-10-27", system_hours: 1.5 }, { work_date: "2026-10-26", system_hours: 9 }, { work_date: "2026-10-27", system_hours: 0.5 }] },
      { id: "b", worklogs: null },
    ];
    const out = withTodayHours(rows, "2026-10-27");
    expect(out[0].today_system_hours).toBe(2);
    expect(out[0].worklogs).toHaveLength(3);
    expect(out[1]).toMatchObject({ today_system_hours: 0, worklogs: [] });
  });
});

describe("mergeById", () => {
  it("dedupes by id and lets later lists win", () => {
    const out = mergeById([{ id: "1", v: "old" }, { id: "2", v: "x" }], [{ id: "1", v: "new" }]);
    expect(out).toHaveLength(2);
    expect(out.find((t) => t.id === "1")?.v).toBe("new");
  });
});

describe("queries", () => {
  it("fetchRecentTasks embeds worklogs, applies the window and never selects the whole worklog table", async () => {
    await fetchRecentTasks("2026-10-13", "2026-10-27");
    expect(calls).toContainEqual(["from", "tasks"]);
    expect(calls).toContainEqual(["select", "*, worklogs:task_worklogs(id,task_id,user_id,work_date,system_hours,logged_hours,updated_at)"]);
    expect(calls).toContainEqual(["or", recentFilter("2026-10-13")]);
    expect(calls.some((c) => c[0] === "from" && c[1] === "task_worklogs")).toBe(false);
  });

  it("fetchOlderCompleted only asks for Completed rows older than the window, optionally one assignee / delta", async () => {
    await fetchOlderCompleted("2026-10-13", "2026-10-27", "u1", "2026-10-20T00:00:00Z");
    expect(calls).toContainEqual(["eq", "status", "Completed"]);
    expect(calls).toContainEqual(["or", olderCompletedFilter("2026-10-13")]);
    expect(calls).toContainEqual(["eq", "assigned_to", "u1"]);
    expect(calls).toContainEqual(["gte", "updated_at", "2026-10-20T00:00:00Z"]);
  });

  it("the older summary selects only id, assigned_to and priority", async () => {
    result = { data: [{ id: "1", assigned_to: "u", priority: "High" }], error: null };
    const rows = await fetchOlderCompletedSummary("2026-10-13");
    expect(calls).toContainEqual(["select", "id,assigned_to,priority"]);
    expect(rows).toHaveLength(1);
  });

  it("countOlderCompleted is a HEAD count", async () => {
    result = { data: null, error: null, count: 929 };
    expect(await countOlderCompleted("2026-10-13")).toBe(929);
    expect(calls).toContainEqual(["select", "id", { count: "exact", head: true }]);
  });

  it("errors are thrown, not swallowed into an empty list", async () => {
    result = { data: null, error: new Error("boom") };
    await expect(fetchRecentTasks("2026-10-13", "2026-10-27")).rejects.toThrow("boom");
  });
});

describe("My Day: my tasks with only THEIR worklogs", () => {
  it("is one tasks query for the user with worklogs embedded, and never touches the whole worklogs table", async () => {
    result = {
      data: [{ id: "t1", worklogs: [{ work_date: "2026-10-28", system_hours: 2 }, { work_date: "2026-10-01", system_hours: 9 }] }],
      error: null,
    };
    const rows = await fetchMyTasksWithWorklogs("u1", "2026-10-28");
    expect(calls).toContainEqual(["from", "tasks"]);
    expect(calls).toContainEqual(["select", "*, worklogs:task_worklogs(id,task_id,user_id,work_date,system_hours,logged_hours,updated_at)"]);
    expect(calls).toContainEqual(["eq", "assigned_to", "u1"]);
    expect(calls.some((c) => c[0] === "from" && c[1] === "task_worklogs")).toBe(false);
    // Same enrichment the page used to compute from the full worklogs table.
    expect(rows[0].today_system_hours).toBe(2);
    expect(rows[0].worklogs).toHaveLength(2);
  });

  it("keeps the old ordering (due date ascending, nulls last) and newest worklog first", async () => {
    await fetchMyTasksWithWorklogs("u1", "2026-10-28");
    expect(calls).toContainEqual(["order", "due_date", { ascending: true, nullsFirst: false }]);
    expect(calls).toContainEqual(["order", "work_date", { ascending: false, referencedTable: "worklogs" }]);
  });

  it("throws on a query error instead of returning an empty list", async () => {
    result = { data: null, error: new Error("boom") };
    await expect(fetchMyTasksWithWorklogs("u1", "2026-10-28")).rejects.toThrow("boom");
  });
});

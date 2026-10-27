import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: string[] = [];
let taskRow: { assigned_to: string | null; status: string; started_at?: string | null } | undefined;
let profileActive: boolean | null = true;
let otherActive: Array<Record<string, unknown>> = [];

const client = {
  query: vi.fn(async (sql: string) => {
    queries.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
    if (/FROM public\.tasks WHERE id = \$1 FOR UPDATE/.test(sql))
      return { rows: taskRow ? [taskRow] : [] };
    if (/SELECT is_active/.test(sql)) return { rows: [{ is_active: profileActive }] };
    if (/started_at IS NOT NULL\s+AND status <> 'Completed'/.test(sql)) return { rows: otherActive };
    return { rows: [] };
  }),
  release: vi.fn(),
};

vi.mock("@/integrations/postgres/client.server", () => ({
  getPool: () => ({ connect: async () => client }),
}));

import { startTaskForUser } from "@/lib/task-start.server";

const USER = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";

describe("startTaskForUser (notification action)", () => {
  beforeEach(() => {
    queries.length = 0;
    client.query.mockClear();
    client.release.mockClear();
    taskRow = { assigned_to: USER, status: "To Do" };
    profileActive = true;
    otherActive = [];
  });

  it("starts an assigned To Do task in one committed transaction", async () => {
    const r = await startTaskForUser(USER, TASK);
    expect(r.result).toBe("started");
    expect(queries[0]).toBe("BEGIN");
    expect(queries).toContain("COMMIT");
    expect(queries.filter((q) => q.startsWith("UPDATE public.tasks"))).toHaveLength(1);
    expect(client.release).toHaveBeenCalled();
  });

  it("pauses the user's other active task first", async () => {
    otherActive = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        started_at: null,
        system_hours: 1,
        status: "In Progress",
      },
    ];
    await startTaskForUser(USER, TASK);
    expect(queries.filter((q) => q.startsWith("UPDATE public.tasks"))).toHaveLength(2);
  });

  it("refuses a task assigned to someone else, without writing", async () => {
    taskRow = { assigned_to: "someone-else", status: "To Do" };
    expect((await startTaskForUser(USER, TASK)).result).toBe("forbidden");
    expect(queries.some((q) => q.startsWith("UPDATE"))).toBe(false);
    expect(queries).toContain("ROLLBACK");
  });

  it("refuses inactive users", async () => {
    profileActive = false;
    expect((await startTaskForUser(USER, TASK)).result).toBe("forbidden");
  });

  it("resumes an In Progress task whose timer is paused", async () => {
    taskRow = { assigned_to: USER, status: "In Progress", started_at: null };
    expect((await startTaskForUser(USER, TASK)).result).toBe("started");
  });

  it("is idempotent for an already running task", async () => {
    taskRow = { assigned_to: USER, status: "In Progress", started_at: "2026-03-10T10:00:00Z" };
    expect((await startTaskForUser(USER, TASK)).result).toBe("already_in_progress");
    expect(queries.some((q) => q.startsWith("UPDATE"))).toBe(false);
  });

  it.each(["Completed", "Blocked", "On Hold", "In Review"])(
    "does not start a %s task",
    async (status) => {
      taskRow = { assigned_to: USER, status };
      const r = await startTaskForUser(USER, TASK);
      expect(r.result).toBe(status === "Completed" ? "completed" : "not_eligible");
      expect(queries.some((q) => q.startsWith("UPDATE"))).toBe(false);
    },
  );

  it("reports a missing task", async () => {
    taskRow = undefined;
    expect((await startTaskForUser(USER, TASK)).result).toBe("not_found");
  });
});

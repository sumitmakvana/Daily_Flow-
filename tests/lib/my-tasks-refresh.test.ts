import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; cols?: string; opts?: any; ops: Array<[string, ...any[]]> };
const calls: Call[] = [];
let respond: (c: Call) => any = () => ({ data: [], error: null });

function builder(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const b: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") return (res: any, rej: any) => Promise.resolve(respond(call)).then(res, rej);
        if (prop === "select") return (cols: string, opts?: any) => ((call.cols = cols), (call.opts = opts), b);
        return (...args: any[]) => (call.ops.push([prop, ...args]), b);
      },
    },
  );
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t) } }));

import { completedCountMayHaveChanged, refreshMyTasksWithWorklogs, type TaskWithWorklogs } from "@/lib/task-window";

const T0 = "2026-11-02T08:00:00.000Z";
const T1 = "2026-11-02T09:30:00.000Z";
const row = (id: string, over: Partial<TaskWithWorklogs> = {}) =>
  ({ id, status: "To Do", due_date: "2026-11-05", updated_at: T0, worklogs: [], today_system_hours: 0, ...over }) as unknown as TaskWithWorklogs;

const prev = [row("a", { due_date: "2026-11-01" }), row("b", { due_date: "2026-11-03" }), row("c", { due_date: null })];
const ofKind = (k: "count" | "rows" | "logs") =>
  calls.filter((c) => (k === "logs" ? c.table === "task_worklogs" : c.table === "tasks" && (k === "count" ? c.opts?.head : !c.opts?.head)));

beforeEach(() => {
  calls.length = 0;
  respond = () => ({ data: [], error: null });
});

describe("refreshMyTasksWithWorklogs", () => {
  it("reads only the changed rows and the window size - not the whole list, and no worklog request when a task row changed", async () => {
    respond = (c) =>
      c.table === "task_worklogs"
        ? { data: [], error: null }
        : c.opts?.head
          ? { count: 3, error: null }
          : { data: [{ ...row("b"), status: "In Progress", updated_at: T1, worklogs: [] }], error: null };
    const r = await refreshMyTasksWithWorklogs(prev, "me", "2026-11-02", "2026-10-19");
    expect(r.full).toBe(false);
    expect(r.changed.map((t) => t.id)).toEqual(["b"]);
    expect(r.rows.find((t) => t.id === "b")?.status).toBe("In Progress");
    expect(r.rows.map((t) => t.id)).toEqual(["a", "b", "c"]); // due-date order, undated last
    const rows = ofKind("rows")[0];
    expect(rows.ops).toContainEqual(["eq", "assigned_to", "me"]);
    expect(rows.ops.find((o) => o[0] === "gte" && o[1] === "updated_at")).toBeTruthy();
    expect(ofKind("count")).toHaveLength(1);
    expect(ofKind("logs")).toHaveLength(0); // the changed row already carries its fresh worklogs
    expect(calls).toHaveLength(2); // rows + count; no full read
  });

  it("falls back to the full read when held + changed rows do not match the window size (a task left it)", async () => {
    respond = (c) => (c.opts?.head ? { count: 2, error: null } : { data: [row("a"), row("b")], error: null });
    const r = await refreshMyTasksWithWorklogs(prev, "me", "2026-11-02", "2026-10-19");
    expect(r.full).toBe(true);
    expect(r.rows.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("does a full read when nothing is held, and never reads worklogs without held tasks", async () => {
    respond = () => ({ data: [row("a")], error: null });
    const r = await refreshMyTasksWithWorklogs(undefined, "me", "2026-11-02", "2026-10-19");
    expect(r.full).toBe(true);
    expect(ofKind("logs")).toHaveLength(0);
    expect(ofKind("count")).toHaveLength(0);
  });

  it("with no changed task row it reads the held tasks' new worklogs (a worklog-only change), and folds them in", async () => {
    respond = (c) =>
      c.table === "task_worklogs"
        ? { data: [{ id: "w1", task_id: "a", user_id: "me", work_date: "2026-11-02", system_hours: 1.5, logged_hours: 0, updated_at: T1 }], error: null }
        : c.opts?.head
          ? { count: 3, error: null }
          : { data: [], error: null };
    const r = await refreshMyTasksWithWorklogs(prev, "me", "2026-11-02", "2026-10-19");
    expect(r.rows.find((t) => t.id === "a")?.worklogs.map((w) => w.id)).toEqual(["w1"]);
    expect(r.rows.find((t) => t.id === "a")?.today_system_hours).toBe(1.5);
    expect(r.full).toBe(false);
    expect(ofKind("logs")).toHaveLength(1);
    expect(ofKind("logs")[0].ops.find((o) => o[0] === "in")?.[1]).toBe("task_id"); // held tasks only, never the whole team
  });

  it("an error propagates (the page then keeps the list on screen / reloads in full)", async () => {
    respond = (c) => (c.opts?.head ? { count: 3, error: null } : { data: null, error: new Error("boom") });
    await expect(refreshMyTasksWithWorklogs(prev, "me", "2026-11-02", "2026-10-19")).rejects.toThrow("boom");
  });
});

describe("completedCountMayHaveChanged", () => {
  const held = [{ id: "a", status: "To Do" }, { id: "d", status: "Completed" }];
  it("is false for an edit to a task that stays open", () => {
    expect(completedCountMayHaveChanged(held, [{ id: "a", status: "In Progress" }])).toBe(false);
  });
  it("is true when a changed row is completed, was completed, or is new to the list", () => {
    expect(completedCountMayHaveChanged(held, [{ id: "a", status: "Completed" }])).toBe(true);
    expect(completedCountMayHaveChanged(held, [{ id: "d", status: "In Progress" }])).toBe(true);
    expect(completedCountMayHaveChanged(held, [{ id: "z", status: "To Do" }])).toBe(true);
  });
});

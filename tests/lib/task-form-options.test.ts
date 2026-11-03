import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ table: string; limit?: number; cols?: string }> = [];
let taskRows: unknown[] = [];
let fail = false;

function builder(table: string) {
  const call: { table: string; limit?: number; cols?: string } = { table };
  calls.push(call);
  const b: any = {
    select: (c: string) => ((call.cols = c), b),
    order: () => b,
    limit: (n: number) => ((call.limit = n), b),
    then: (res: any, rej: any) =>
      Promise.resolve(
        fail
          ? { data: null, error: new Error("boom") }
          : { data: table === "tasks" ? taskRows : [{ id: "p1", name: "Alpha", client: "C" }], error: null },
      ).then(res, rej),
  };
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t) } }));
vi.mock("@/integrations/backend/auth", () => ({
  auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
}));
const hintsFn = vi.fn();
vi.mock("@/services/task-form-hints.functions", () => ({ fetchTaskNameHintsFn: (...a: unknown[]) => hintsFn(...a) }));
const typesList = vi.fn(async () => [{ id: "t" }]);
vi.mock("@/services/work-item-types", () => ({ workItemTypesService: { list: () => typesList() } }));
vi.mock("@/services/operations", () => ({ holidaysService: { list: async () => [] } }));
vi.mock("@/services/leaves", () => ({ leavesService: { getLeaves: async () => [] } }));

import * as o from "@/lib/task-form-options";

beforeEach(() => {
  calls.length = 0;
  fail = false;
  typesList.mockClear();
  // Default: the server function is unavailable, so these tests exercise the REST fallback path.
  hintsFn.mockReset();
  hintsFn.mockRejectedValue(new Error("server function unavailable"));
  o.resetTaskFormOptions();
  (globalThis as any).window = globalThis;
  taskRows = [
    { assigned_to: "u1", client: "Acme", project_name: "Web" },
    { assigned_to: "u1", client: "Old", project_name: "Legacy" },
    { assigned_to: "u2", client: null, project_name: null },
    { assigned_to: null, client: "Acme", project_name: "Web" },
  ];
});

describe("task name hints from the database (server function)", () => {
  const payload = {
    lastByAssignee: { u1: { client: "Acme", project_name: "Web" } },
    pairs: [{ project_name: "Web", client: "Acme" }],
  };

  it("uses the already-reduced result and downloads no task rows", async () => {
    hintsFn.mockResolvedValue(payload);
    const h = await o.loadTaskNameHints();
    expect(h).toEqual(payload);
    expect(hintsFn).toHaveBeenCalledWith({ data: { limit: o.TASK_HINT_ROWS } });
    expect(calls.filter((c) => c.table === "tasks")).toHaveLength(0);
  });

  it("is cached: opening the form again, or two forms at once, makes one request", async () => {
    hintsFn.mockResolvedValue(payload);
    await Promise.all([o.loadTaskNameHints(), o.loadTaskNameHints()]);
    await o.loadTaskNameHints();
    expect(hintsFn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the bounded REST read when the server function fails, so suggestions never disappear", async () => {
    const h = await o.loadTaskNameHints(); // default mock rejects
    expect(hintsFn).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.table === "tasks")).toHaveLength(1);
    expect(h.lastByAssignee.u1).toEqual({ client: "Acme", project_name: "Web" });
  });

  it("falls back when the answer has an unexpected shape", async () => {
    hintsFn.mockResolvedValue({ nope: true });
    const h = await o.loadTaskNameHints();
    expect(calls.filter((c) => c.table === "tasks")).toHaveLength(1);
    expect(h.pairs.length).toBeGreaterThan(0);
  });
});

describe("task form options", () => {
  it("reads tasks once, bounded, with three short columns", async () => {
    const [a, b] = await Promise.all([o.loadTaskNameHints(), o.loadTaskNameHints()]);
    expect(a).toBe(b);
    const t = calls.filter((c) => c.table === "tasks");
    expect(t).toHaveLength(1);
    expect(t[0].limit).toBe(o.TASK_HINT_ROWS);
    expect(t[0].cols).toBe("assigned_to, client, project_name");
  });

  it("derives each person's newest task and the distinct project pairs", async () => {
    const h = await o.loadTaskNameHints();
    expect(h.lastByAssignee.u1).toEqual({ client: "Acme", project_name: "Web" });
    expect(h.lastByAssignee.u2).toEqual({ client: "", project_name: "" });
    expect(h.pairs).toEqual([
      { project_name: "Web", client: "Acme" },
      { project_name: "Legacy", client: "Old" },
    ]);
  });

  it("reuses cached lists across opens, and invalidate forces a refetch", async () => {
    await o.loadMasterProjects();
    await o.loadMasterProjects();
    await o.loadWorkItemTypes();
    await o.loadWorkItemTypes();
    expect(calls.filter((c) => c.table === "projects")).toHaveLength(1);
    expect(typesList).toHaveBeenCalledTimes(1);
    o.invalidateTaskFormOptions();
    await o.loadMasterProjects();
    expect(calls.filter((c) => c.table === "projects")).toHaveLength(2);
  });

  it("does not cache failures", async () => {
    fail = true;
    await expect(o.loadTaskNameHints()).rejects.toThrow("boom");
    fail = false;
    await expect(o.loadTaskNameHints()).resolves.toBeTruthy();
    expect(calls.filter((c) => c.table === "tasks")).toHaveLength(2);
  });

  it("refetches after the TTL", async () => {
    vi.useFakeTimers();
    await o.loadMasterProjects();
    vi.advanceTimersByTime(o.OPTIONS_TTL_MS + 1);
    await o.loadMasterProjects();
    vi.useRealTimers();
    expect(calls.filter((c) => c.table === "projects")).toHaveLength(2);
  });
});

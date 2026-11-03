import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; cols?: string; opts?: any; ops: Array<[string, ...any[]]> };
const calls: Call[] = [];
let respond: (c: Call) => any = () => ({ data: [], error: null, count: 0 });

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

import { searchTaskPage, searchTaskCounts, searchMembers, resetTaskSearch, TASK_SEARCH_COLS, STATUS_SAMPLE } from "@/lib/task-search";

const mgr = { userId: "m1", canSeeAll: true };
const member = { userId: "u1", canSeeAll: false };
const ors = (c: Call) => c.ops.filter((o) => o[0] === "or").map((o) => o[1] as string);

beforeEach(() => {
  calls.length = 0;
  resetTaskSearch();
  respond = () => ({ data: [], error: null, count: 0 });
});

describe("searchTaskPage", () => {
  it("asks for one page of short columns with an exact count, newest first", async () => {
    respond = () => ({ data: [{ id: "a" }], error: null, count: 100 });
    const r = await searchTaskPage({ scope: mgr, query: "", tab: "all", page: 3, pageSize: 6 });
    const c = calls[0];
    expect(r.total).toBe(100);
    expect(c.cols).toBe(TASK_SEARCH_COLS);
    expect(c.cols).not.toContain("*");
    expect(c.opts).toEqual({ count: "exact" });
    expect(c.ops).toContainEqual(["order", "updated_at", { ascending: false }]);
    expect(c.ops).toContainEqual(["range", 12, 17]);
    expect(c.ops.find((o) => o[0] === "eq")).toBeUndefined(); // manager: no scope filter
  });

  it("limits a member to their own tasks, and fails closed without a user", async () => {
    await searchTaskPage({ scope: member, query: "", tab: "all", page: 1, pageSize: 6 });
    expect(calls[0].ops).toContainEqual(["eq", "assigned_to", "u1"]);
    await searchTaskPage({ scope: { userId: "", canSeeAll: false }, query: "", tab: "all", page: 1, pageSize: 6 });
    expect(calls[1].ops).toContainEqual(["eq", "assigned_to", "00000000-0000-0000-0000-000000000000"]);
  });

  it("filters the tab on the server ('pending' is 'To Do')", async () => {
    await searchTaskPage({ scope: mgr, query: "", tab: "pending", page: 1, pageSize: 6 });
    await searchTaskPage({ scope: mgr, query: "", tab: "in_review", page: 1, pageSize: 6 });
    expect(calls[0].ops).toContainEqual(["eq", "status", "To Do"]);
    expect(calls[1].ops).toContainEqual(["eq", "status", "In Review"]);
  });

  it("first word: text columns only; later words also match status / priority; commas cannot break the filter", async () => {
    await searchTaskPage({ scope: mgr, query: "Login, high prog", tab: "all", page: 1, pageSize: 6 });
    const [first, second, third] = ors(calls[0]);
    expect(first).toBe("task_code.ilike.%login%,task_name.ilike.%login%,project_name.ilike.%login%,client.ilike.%login%,remarks.ilike.%login%");
    expect(second).toContain('priority.in.("High")');
    expect(second).not.toContain("status.in");
    expect(third).toContain('status.in.("In Progress")');
  });

  it("shares identical simultaneous requests but not different pages", async () => {
    const a = { scope: mgr, query: "x", tab: "all" as const, page: 1, pageSize: 6 };
    await Promise.all([searchTaskPage(a), searchTaskPage(a)]);
    expect(calls).toHaveLength(1);
    await searchTaskPage({ ...a, page: 2 });
    expect(calls).toHaveLength(2);
  });

  it("does not cache a failure", async () => {
    respond = () => ({ data: null, error: new Error("boom"), count: null });
    await expect(searchTaskPage({ scope: mgr, query: "", tab: "all", page: 1, pageSize: 6 })).rejects.toThrow("boom");
    respond = () => ({ data: [], error: null, count: 0 });
    await expect(searchTaskPage({ scope: mgr, query: "", tab: "all", page: 1, pageSize: 6 })).resolves.toBeTruthy();
  });
});

describe("searchTaskCounts", () => {
  it("derives every counter from ONE status-only request when the matches fit the sample", async () => {
    respond = () => ({
      data: [{ status: "To Do" }, { status: "Completed" }, { status: "Completed" }, { status: "In Progress" }, { status: "In Review" }],
      error: null,
      count: 5,
    });
    const r = await searchTaskCounts(mgr, "");
    expect(calls).toHaveLength(1);
    expect(calls[0].cols).toBe("status");
    expect(r).toEqual({ all: 5, in_progress: 1, pending: 1, completed: 2, in_review: 1 });
  });

  it("falls back to exact head counts when more rows match than the sample holds", async () => {
    respond = (c) =>
      c.opts?.head
        ? { error: null, count: 7 }
        : { data: Array.from({ length: STATUS_SAMPLE }, () => ({ status: "To Do" })), error: null, count: 5000 };
    const r = await searchTaskCounts(mgr, "");
    expect(calls).toHaveLength(5);
    expect(r).toEqual({ all: 5000, in_progress: 7, pending: 7, completed: 7, in_review: 7 });
  });
});

describe("searchMembers", () => {
  it("returns nothing for an empty query without a request, and filters by every word", async () => {
    expect(await searchMembers("  ")).toEqual([]);
    expect(calls).toHaveLength(0);
    respond = () => ({
      data: [
        { id: "1", display_name: "Asha Rao", email: "asha@x.com" },
        { id: "2", display_name: "Asha Patel", email: "ap@x.com" },
      ],
      error: null,
    });
    const r = await searchMembers("asha rao");
    expect(r.map((m) => m.id)).toEqual(["1"]);
    expect(calls[0].ops).toContainEqual(["limit", 20]);
  });
});

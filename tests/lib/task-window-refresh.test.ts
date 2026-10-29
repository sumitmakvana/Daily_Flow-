import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; select?: string; opts?: { count?: string; head?: boolean }; ops: Array<[string, unknown[]]> };
let headCount = 0;
let calls: Call[] = [];
let respond: (c: Call) => unknown[] = () => [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const c: Call = { table, ops: [] };
      calls.push(c);
      const chain: any = new Proxy(
        {},
        {
          get: (_t, prop: string) => {
            if (prop === "then") {
              return (res: (v: unknown) => void) => res({ data: respond(c), count: c.opts?.count ? headCount : undefined, error: null });
            }
            if (prop === "select") return (cols: string, opts?: Call["opts"]) => ((c.select = cols), (c.opts = opts), chain);
            return (...args: unknown[]) => (c.ops.push([prop, args]), chain);
          },
        },
      );
      return chain;
    },
  },
}));

import { loadAllTasksSlim, refreshRecentTasks } from "@/lib/task-window";

const TODAY = "2026-10-28";
const wl = (id: string, task_id: string, work_date: string, sys: number, updated_at: string) =>
  ({ id, task_id, user_id: "u", work_date, system_hours: sys, logged_hours: 0, created_at: updated_at, updated_at }) as any;
const task = (id: string, o: Record<string, unknown> = {}) =>
  ({ id, status: "In Progress", updated_at: "2026-10-28T09:00:00Z", worklogs: [], today_system_hours: 0, ...o }) as any;

beforeEach(() => {
  calls = [];
  respond = () => [];
});

describe("refreshRecentTasks (delta refresh of a loaded window)", () => {
  it("falls back to the full load when nothing is held", async () => {
    respond = (c) => (c.select?.includes("worklogs") ? [task("a")] : []);
    const out = await refreshRecentTasks([], "2026-10-14", TODAY);
    expect(out.map((t) => t.id)).toEqual(["a"]);
    expect(calls.some((c) => c.ops.some(([op]) => op === "gte"))).toBe(false); // no delta filter
  });

  it("drops tasks that left the window, applies changed rows, folds in new worklogs", async () => {
    const prev = [task("a", { worklogs: [wl("w1", "a", "2026-10-27", 1, "2026-10-27T10:00:00Z")] }), task("b")];
    headCount = 1; // the window now holds one task, but held + changed is two: ids are read to prune
    respond = (c) => {
      if (c.select === "id" && !c.opts) return [{ id: "a" }]; // b was deleted / left the window
      if (c.table === "task_worklogs") return [wl("w2", "a", TODAY, 2.5, "2026-10-28T09:30:00Z")];
      if (c.select?.includes("worklogs") && c.ops.some(([op]) => op === "gte")) {
        return [task("a", { status: "Completed", updated_at: "2026-10-28T09:20:00Z", worklogs: [wl("w1", "a", "2026-10-27", 1, "2026-10-27T10:00:00Z")] })];
      }
      return [];
    };
    const out = await refreshRecentTasks(prev, "2026-10-14", TODAY);
    expect(out.map((t) => t.id)).toEqual(["a"]); // b removed
    expect(out[0].status).toBe("Completed"); // changed row applied
    expect(out[0].worklogs.map((w: any) => w.id).sort()).toEqual(["w1", "w2"]); // new worklog folded in
    expect(out[0].today_system_hours).toBe(2.5); // recomputed from today's worklog
  });

  it("fetches full rows for ids it does not hold yet", async () => {
    const prev = [task("a")];
    headCount = 2; // the window holds two, held + changed is one: ids are read, n is fetched
    respond = (c) => {
      if (c.select === "id" && !c.opts) return [{ id: "a" }, { id: "n" }]; // n entered the window without being "changed"
      if (c.select?.includes("worklogs") && c.ops.some(([op]) => op === "in")) return [task("n")];
      return [];
    };
    const out = await refreshRecentTasks(prev, "2026-10-14", TODAY);
    expect(out.map((t) => t.id).sort()).toEqual(["a", "n"]);
  });

  it("asks only for rows updated since the newest one held, minus an overlap", async () => {
    const prev = [task("a", { updated_at: "2026-10-28T09:00:00.000Z" })];
    headCount = 1; // nothing was added or removed
    respond = () => [];
    await refreshRecentTasks(prev, "2026-10-14", TODAY);
    const gte = calls.flatMap((c) => c.ops).filter(([op]) => op === "gte").map(([, a]) => a);
    expect(gte).toContainEqual(["updated_at", "2026-10-28T08:59:00.000Z"]);
  });

  it("reads no ids at all when held + changed matches the window's exact size", async () => {
    const prev = [task("a"), task("b")];
    headCount = 2;
    respond = () => [];
    await refreshRecentTasks(prev, "2026-10-14", TODAY);
    expect(calls.some((c) => c.select === "id" && !c.opts)).toBe(false); // only the head count ran
  });
});

describe("loadAllTasksSlim (light rows of every task, changed rows only after the first read)", () => {
  const COLS = "id,status,updated_at";
  const row = (id: string, status: string, updated_at: string) => ({ id, status, updated_at }) as any;
  const held = [row("a", "To Do", "2026-10-28T09:00:00Z"), row("b", "To Do", "2026-10-28T08:00:00Z")];

  it("reads everything the first time", async () => {
    respond = () => held;
    const at = { current: 0 };
    const out = await loadAllTasksSlim(COLS, undefined, at);
    expect(out).toHaveLength(2);
    expect(at.current).toBeGreaterThan(0);
    expect(calls.every((c) => !c.ops.some(([op]) => op === "gte"))).toBe(true);
  });

  it("afterwards reads only rows updated since, and proves no deletion with a head count", async () => {
    const at = { current: Date.now() };
    headCount = 3;
    respond = (c) => (c.opts?.head ? [] : [row("a", "Completed", "2026-10-28T09:30:00Z"), row("c", "To Do", "2026-10-28T09:40:00Z")]);
    const out = await loadAllTasksSlim(COLS, held, at);
    expect(out.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
    expect(out.find((t) => t.id === "a")!.status).toBe("Completed");
    const gte = calls.flatMap((c) => c.ops).filter(([op]) => op === "gte").map(([, a]) => a);
    expect(gte).toContainEqual(["updated_at", "2026-10-28T08:59:00.000Z"]);
  });

  it("falls back to a full read when the count shows a deletion", async () => {
    const at = { current: Date.now() };
    headCount = 1; // b was deleted
    respond = (c) => (c.opts?.head ? [] : c.ops.some(([op]) => op === "gte") ? [] : [row("a", "To Do", "2026-10-28T09:00:00Z")]);
    const out = await loadAllTasksSlim(COLS, held, at);
    expect(out.map((t) => t.id)).toEqual(["a"]);
  });

  it("does a full read when the last one is older than the reload interval", async () => {
    const at = { current: Date.now() - 6 * 60_000 };
    respond = () => held;
    await loadAllTasksSlim(COLS, held, at);
    expect(calls.every((c) => !c.ops.some(([op]) => op === "gte"))).toBe(true);
  });
});

import { fetchOlderCompletedCounts, fetchRecentTasks } from "@/lib/task-window";

describe("column lists and head-only counts", () => {
  it("with a column list, tasks are read without the worklog embed (and without its ordering)", async () => {
    respond = () => [{ id: "a" }];
    await fetchRecentTasks("2026-10-14", TODAY, "id,status");
    expect(calls[0].select).toBe("id,status");
    expect(calls[0].ops.some(([op, a]) => op === "order" && JSON.stringify(a).includes("referencedTable"))).toBe(false);
  });
  it("without one, full rows embed their worklogs, newest first", async () => {
    respond = () => [task("a")];
    await fetchRecentTasks("2026-10-14", TODAY);
    expect(calls[0].select).toContain("worklogs:task_worklogs");
    expect(calls[0].ops.some(([op, a]) => op === "order" && JSON.stringify(a).includes("referencedTable"))).toBe(true);
  });
  it("older-completed counts are head-only requests: total, mine, and per priority", async () => {
    headCount = 7;
    const out = await fetchOlderCompletedCounts("2026-10-14", "me", ["High", "Low"]);
    expect(calls).toHaveLength(2 + 2 + 2); // total, mine, 2 priorities, 2 mine x priority
    expect(calls.every((c) => c.opts?.head === true && c.opts?.count === "exact")).toBe(true);
    expect(out).toMatchObject({ forUser: "me", total: 7, mine: 7, byPriority: { High: 7, Low: 7 } });
  });
  it("makes no 'mine' requests until the signed-in user is known", async () => {
    headCount = 3;
    const out = await fetchOlderCompletedCounts("2026-10-14", "", ["High"]);
    expect(calls).toHaveLength(2); // total + High
    expect(out.mine).toBe(0);
  });
});

import { countMyCompleted, fetchMyTasksWithWorklogs } from "@/lib/task-window";

describe("My Day window", () => {
  it("reads open tasks plus recent completions of ONE user, with only their worklogs", async () => {
    respond = () => [task("a")];
    await fetchMyTasksWithWorklogs("me", TODAY, "2026-10-14");
    const ops = calls[0].ops.map(([op, a]) => `${op}:${JSON.stringify(a)}`);
    expect(calls[0].select).toContain("worklogs:task_worklogs");
    expect(ops.some((o) => o.startsWith("eq:") && o.includes('"assigned_to","me"'))).toBe(true);
    expect(ops.some((o) => o.startsWith("or:") && o.includes("status.neq.Completed"))).toBe(true);
  });
  it("without a cutoff it still returns every task of the user", async () => {
    respond = () => [task("a")];
    await fetchMyTasksWithWorklogs("me", TODAY);
    expect(calls[0].ops.some(([op]) => op === "or")).toBe(false);
  });
  it("counts everything the user ever completed with a head-only request", async () => {
    headCount = 41;
    expect(await countMyCompleted("me")).toBe(41);
    expect(calls[0].opts).toEqual({ count: "exact", head: true });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { table: string; select?: string; opts?: Record<string, unknown>; ops: Array<[string, unknown[]]> };
let calls: Call[] = [];
let respond: (c: Call) => unknown[] = () => [];
let headCount = 0;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const c: Call = { table, ops: [] };
      calls.push(c);
      const chain: any = new Proxy(
        {},
        {
          get: (_t, prop: string) => {
            if (prop === "then") return (res: (v: unknown) => void) => res({ data: respond(c), count: c.opts?.count ? headCount : undefined, error: null });
            if (prop === "select") return (cols: string, opts?: Record<string, unknown>) => ((c.select = cols), (c.opts = opts), chain);
            return (...args: unknown[]) => (c.ops.push([prop, args]), chain);
          },
        },
      );
      return chain;
    },
  },
}));

import {
  ALL_ASSIGNEES,
  PAGE_SELECT,
  applyFilters,
  applySort,
  applyTab,
  buildPageQuery,
  dateWindow,
  fetchAllTaskRows,
  fetchHeaderCounts,
  fetchSidebarCounts,
  fetchTabCounts,
  fetchTaskListPage,
  pageRange,
  searchTokens,
  tokenClause,
  type ListFilters,
  type Person,
  type TaskListParams,
} from "@/lib/task-list-query";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/types";

const people: Person[] = [
  { id: "u-aad", name: "Aaditya Desai", email: "aaditya@x.io" },
  { id: "u-mil", name: "Milan Patel", email: "milan@x.io" },
];
const F = (o: Partial<ListFilters> = {}): ListFilters => ({ statuses: [], priorities: [], assignee: ALL_ASSIGNEES, q: "", dateFilter: ALL_ASSIGNEES, ...o });
const P = (o: Partial<TaskListParams> = {}): TaskListParams => ({
  scope: { userId: "me", canSeeAll: true }, tab: "all_tasks", filters: F(), sortBy: "newest", page: 1, pageSize: 25, people, ...o,
});
const ops = (c: Call) => c.ops.map(([op, a]) => `${op}:${a.map((x) => JSON.stringify(x)).join(",")}`);
const run = (fn: (q: any) => any) => {
  const holder: any = new Proxy({}, { get: (_t, prop: string) => (...a: unknown[]) => (rec.push(`${prop}:${a.map((x) => JSON.stringify(x)).join(",")}`), holder) });
  const rec: string[] = [];
  fn(holder);
  return rec;
};

beforeEach(() => {
  calls = [];
  respond = () => [];
  headCount = 0;
});

describe("scope and tabs", () => {
  it("my tab = assigned to me; team tab = everyone else INCLUDING unassigned; all = no restriction", () => {
    const sc = { userId: "me", canSeeAll: true };
    expect(run((q) => applyTab(q, "my_tasks", sc))).toEqual(['eq:"assigned_to","me"']);
    expect(run((q) => applyTab(q, "team_tasks", sc))).toEqual(['or:"assigned_to.is.null,assigned_to.neq.me"']);
    expect(run((q) => applyTab(q, "all_tasks", sc))).toEqual([]);
  });
  it("a member is restricted to their own tasks on EVERY tab, and an assignee filter cannot widen it", () => {
    const sc = { userId: "me", canSeeAll: false };
    for (const tab of ["my_tasks", "team_tasks", "all_tasks"] as const) expect(run((q) => applyTab(q, tab, sc))).toEqual(['eq:"assigned_to","me"']);
    expect(run((q) => applyFilters(q, F({ assignee: "someone-else" }), people, sc))).toEqual([]);
    expect(run((q) => applyFilters(q, F({ assignee: "someone-else" }), people, { userId: "me", canSeeAll: true }))).toEqual(['eq:"assigned_to","someone-else"']);
  });
});

describe("filters and search", () => {
  const sc = { userId: "me", canSeeAll: true };
  it("status and priority are IN lists", () => {
    expect(run((q) => applyFilters(q, F({ statuses: ["In Progress", "To Do"], priorities: ["High"] }), people, sc))).toEqual([
      'in:"status",["In Progress","To Do"]',
      'in:"priority",["High"]',
    ]);
  });
  it("search terms drop characters that would change a PostgREST filter or a LIKE pattern", () => {
    expect(searchTokens('  Ab,c (x)*  "q"  %_ ')).toEqual(["abc", "x", "q"]);
    expect(searchTokens("   ")).toEqual([]);
  });
  it("a term matches text columns, status / priority text, assignee name+email and reviewer name", () => {
    const c = tokenClause("progress", people);
    for (const col of ["task_code", "task_name", "client", "project_name", "remarks"]) expect(c).toContain(`${col}.ilike.*progress*`);
    expect(c).toContain('status.in.("In Progress")');
    expect(tokenClause("high", people)).toContain('priority.in.("High")');
    const byName = tokenClause("aaditya", people);
    expect(byName).toContain("assigned_to.in.(u-aad)");
    expect(byName).toContain("reviewer.in.(u-aad)");
    // an email-only match finds the assignee but not as a reviewer (the old search matched reviewer names only)
    const byEmail = tokenClause("x.io", people);
    expect(byEmail).toContain("assigned_to.in.(u-aad,u-mil)");
    expect(byEmail).not.toContain("reviewer.in.");
  });
  it("every search term is its own AND-ed `or` group", () => {
    const rec = run((q) => applyFilters(q, F({ q: "alpha beta" }), people, sc));
    expect(rec.filter((r) => r.startsWith("or:"))).toHaveLength(2);
  });
  it("date filters use due_date, falling back to start_date when there is no due date", () => {
    const w = dateWindow(new Date("2026-10-28T10:00:00Z"));
    expect(w).toEqual({ today: "2026-10-28", tomorrow: "2026-10-29", weekStart: "2026-10-26", weekEnd: "2026-11-01" });
    expect(run((q) => applyFilters(q, F({ dateFilter: "today" }), people, sc, w))).toEqual(['or:"due_date.eq.2026-10-28,and(due_date.is.null,start_date.eq.2026-10-28)"']);
    expect(run((q) => applyFilters(q, F({ dateFilter: "overdue" }), people, sc, w))).toEqual([
      'neq:"status","Completed"',
      'or:"due_date.lt.2026-10-28,and(due_date.is.null,start_date.lt.2026-10-28)"',
    ]);
    expect(run((q) => applyFilters(q, F({ dateFilter: "no_due_date" }), people, sc, w))).toEqual(['is:"due_date",null', 'is:"start_date",null']);
    expect(run((q) => applyFilters(q, F({ dateFilter: "this_week" }), people, sc, w))[0]).toContain("due_date.gte.2026-10-26,due_date.lte.2026-11-01");
  });
});

describe("sorting and pages", () => {
  it("every sort ends with id so pages never overlap or skip", () => {
    for (const s of ["newest", "oldest", "due_soon", "due_late"]) expect(run((q) => applySort(q, s)).at(-1)).toBe('order:"id",{"ascending":true}');
    expect(run((q) => applySort(q, "oldest"))[0]).toBe('order:"created_at",{"ascending":true}');
    expect(run((q) => applySort(q, "newest"))[0]).toBe('order:"created_at",{"ascending":false}');
  });
  it("a page is at most 50 rows, whatever is asked", () => {
    expect(pageRange(1, 25)).toEqual([0, 24]);
    expect(pageRange(3, 25)).toEqual([50, 74]);
    expect(pageRange(2, 50)).toEqual([50, 99]);
    expect(pageRange(1, 100)).toEqual([0, 49]);
    expect(pageRange(0, 25)).toEqual([0, 24]);
  });
  it("a page query asks for an exact count, the page range, and worklogs ordered newest first", async () => {
    respond = () => [{ id: "a", worklogs: [] }];
    headCount = 77;
    const res = await fetchTaskListPage(P({ page: 2 }), "2026-10-28");
    expect(res.total).toBe(77);
    const c = calls[0];
    expect(c.select).toBe(PAGE_SELECT);
    expect(c.opts).toEqual({ count: "exact" });
    expect(ops(c).at(-1)).toBe("range:25,49");
    expect(ops(c).some((o) => o.includes("referencedTable"))).toBe(true);
    expect(PAGE_SELECT).toContain("worklogs:task_worklogs(id,task_id,user_id,work_date,system_hours,logged_hours)");
  });
  it("the signature query selects only id and updated_at over the same page", () => {
    const q: any = buildPageQuery(P({ page: 3, pageSize: 50 }), "id,updated_at");
    expect(q).toBeDefined();
    expect(calls[0].select).toBe("id,updated_at");
    expect(ops(calls[0]).at(-1)).toBe("range:100,149");
    expect(ops(calls[0]).some((o) => o.includes("referencedTable"))).toBe(false);
  });
});

describe("counters are head-only counts", () => {
  it("sidebar: one head count per status and per priority", async () => {
    headCount = 3;
    const r = await fetchSidebarCounts("all_tasks", { userId: "me", canSeeAll: true });
    expect(calls).toHaveLength(TASK_STATUSES.length + TASK_PRIORITIES.length);
    expect(calls.every((c) => c.opts?.head === true && c.opts?.count === "exact")).toBe(true);
    expect(r.status["To Do"]).toBe(3);
    expect(r.priority.High).toBe(3);
  });
  it("tab labels: three counts for a manager, one for a member", async () => {
    headCount = 5;
    expect(await fetchTabCounts(P())).toEqual({ my: 5, team: 5, all: 5 });
    expect(calls).toHaveLength(3);
    calls = [];
    expect(await fetchTabCounts(P({ scope: { userId: "me", canSeeAll: false } }))).toEqual({ my: 5, team: 0, all: 5 });
    expect(calls).toHaveLength(1);
  });
  it("header strip: total, mine, overdue; for a member total = mine", async () => {
    headCount = 9;
    expect(await fetchHeaderCounts({ userId: "me", canSeeAll: true })).toEqual({ total: 9, mine: 9, overdue: 9 });
    expect(calls).toHaveLength(3);
    const member = calls.map((c) => ops(c).join("|"));
    expect(member.some((m) => m.includes('neq:"status","Completed"'))).toBe(true);
    calls = [];
    await fetchHeaderCounts({ userId: "me", canSeeAll: false });
    expect(calls.every((c) => ops(c).includes('eq:"assigned_to","me"'))).toBe(true);
  });
});

describe("export", () => {
  it("reads every matching row in chunks, until a short chunk", async () => {
    let n = 0;
    respond = () => (++n < 3 ? Array.from({ length: 500 }, (_, i) => ({ id: `${n}-${i}` })) : [{ id: "last" }]);
    const rows = await fetchAllTaskRows(P(), 500);
    expect(rows).toHaveLength(1001);
    expect(calls).toHaveLength(3);
    expect(ops(calls[1]).at(-1)).toBe("range:500,999");
  });
});

describe("member counters (one light request instead of a dozen head counts)", () => {
  it("counts the sidebar and the KPI strip from the member's own rows", async () => {
    const { countMemberTasks } = await import("@/lib/task-list-query");
    const rows = [
      { status: "To Do", priority: "High", due_date: "2026-10-29", start_date: null },
      { status: "Completed", priority: "Low", due_date: "2026-10-01", start_date: null },
      { status: "In Progress", priority: "High", due_date: null, start_date: "2026-10-20" },
      { status: "Blocked", priority: "Medium", due_date: "2026-11-02", start_date: null },
    ];
    const r = countMemberTasks(rows, "2026-10-30");
    expect(r.sidebar.status["To Do"]).toBe(1);
    expect(r.sidebar.status.Completed).toBe(1);
    expect(r.sidebar.priority.High).toBe(2);
    expect(r.header).toEqual({ total: 4, mine: 4, overdue: 2 }); // completed and future ones are not overdue
  });

  it("asks for four short columns of the member's own tasks, bounded", async () => {
    calls = [];
    respond = () => [];
    const { fetchMemberCounters, MEMBER_COUNTER_MAX_ROWS } = await import("@/lib/task-list-query");
    await fetchMemberCounters("u1");
    expect(calls).toHaveLength(1);
    expect(calls[0].select).toBe("status,priority,due_date,start_date");
    expect(calls[0].ops).toContainEqual(["eq", ["assigned_to", "u1"]]);
    expect(calls[0].ops).toContainEqual(["limit", [MEMBER_COUNTER_MAX_ROWS + 1]]);
  });

  it("returns null (use the head counts) for a member with too many tasks", async () => {
    const { fetchMemberCounters, MEMBER_COUNTER_MAX_ROWS } = await import("@/lib/task-list-query");
    respond = () => Array.from({ length: MEMBER_COUNTER_MAX_ROWS + 1 }, () => ({ status: "To Do", priority: "Low", due_date: null, start_date: null }));
    expect(await fetchMemberCounters("u1")).toBeNull();
  });
});

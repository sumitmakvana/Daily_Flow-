import { describe, expect, it } from "vitest";
import { execRangeFilter, execScopeQuery, managerTreeIds } from "@/lib/task-window";

const NOW = new Date("2026-10-29T10:30:00Z");

describe("execRangeFilter", () => {
  it("Today: open tasks plus anything completed, created or due today", () => {
    expect(execRangeFilter("1", NOW)).toBe(
      'status.not.in.(Completed,"On Hold"),completed_at.gte.2026-10-29,created_at.gte.2026-10-29,due_date.eq.2026-10-29',
    );
  });

  it("N days: cutoff is the UTC day start N days back (never later than the page's own cutoff)", () => {
    const f = execRangeFilter("7", NOW);
    expect(f).toContain("created_at.gte.2026-10-22T00:00:00.000Z");
    expect(f).toContain("completed_at.gte.2026-10-22T00:00:00.000Z");
    // the page cuts at now - 7d = 2026-10-22T10:30Z, which is later, so the window is a superset
    expect(Date.parse("2026-10-22T00:00:00.000Z")).toBeLessThan(NOW.getTime() - 7 * 86400000);
  });

  it("an unknown range falls back to 7 days like the page", () => {
    expect(execRangeFilter("x", NOW)).toBe(execRangeFilter("7", NOW));
  });
});

describe("managerTreeIds", () => {
  const people = [
    { id: "m", manager_id: null },
    { id: "a", manager_id: "m" },
    { id: "b", manager_id: "a" },
    { id: "z", manager_id: "other" },
  ];
  it("walks the whole tree, including the manager and indirect reports", () => {
    expect(managerTreeIds("m", people).sort()).toEqual(["a", "b", "m"]);
  });
  it("a leaf is just themselves", () => {
    expect(managerTreeIds("b", people)).toEqual(["b"]);
  });
});

describe("execScopeQuery", () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const q: any = new Proxy({}, { get: (_t, name: string) => (...a: unknown[]) => (calls.push([name, ...a]), q) });
  const people = [
    { id: "a", team_id: "t1", manager_id: "m" },
    { id: "b", team_id: "t2", manager_id: "m" },
    { id: "m", team_id: "t1", manager_id: null },
  ];

  it("org applies nothing", () => {
    calls.length = 0;
    execScopeQuery({ kind: "org" }, [], people).apply(q);
    expect(calls).toEqual([]);
  });

  it("a member selection wins over the scope (as the page does)", () => {
    calls.length = 0;
    const r = execScopeQuery({ kind: "team", id: "t1" }, ["b", "a"], people);
    r.apply(q);
    expect(calls).toEqual([["in", "assigned_to", ["a", "b"]]]);
    expect(r.key).toBe("members:a,b");
  });

  it("team: its members' tasks or tasks tagged with the team", () => {
    calls.length = 0;
    execScopeQuery({ kind: "team", id: "t1" }, [], people).apply(q);
    expect(calls).toEqual([["or", "assigned_to.in.(a,m),team_id.eq.t1"]]);
  });

  it("team without members falls back to the team tag", () => {
    calls.length = 0;
    execScopeQuery({ kind: "team", id: "none" }, [], people).apply(q);
    expect(calls).toEqual([["eq", "team_id", "none"]]);
  });

  it("manager: the whole tree", () => {
    calls.length = 0;
    execScopeQuery({ kind: "manager", id: "m" }, [], people).apply(q);
    expect(calls).toEqual([["in", "assigned_to", ["a", "b", "m"]]]);
  });

  it("different scopes never share a cache key", () => {
    const keys = [
      execScopeQuery({ kind: "org" }, [], people).key,
      execScopeQuery({ kind: "team", id: "t1" }, [], people).key,
      execScopeQuery({ kind: "manager", id: "m" }, [], people).key,
      execScopeQuery(null, ["a"], people).key,
    ];
    expect(new Set(keys).size).toBe(4);
  });
});

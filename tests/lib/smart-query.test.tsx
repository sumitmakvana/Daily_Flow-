import React from "react";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, focusManager, useQuery, useQueryClient } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createRefreshScheduler, realtimeCovered, slowChanging, useRefreshScheduler } from "@/lib/smart-query";

/**
 * Request-count measurement. The query sets below mirror Team Capacity and Executive with the options they had
 * BEFORE (explicit staleTime, default focus refetch, invalidate per event) and AFTER (smart-query helpers).
 * React Query itself runs for real; each queryFn counts its calls, weighted by how many HTTP requests the real
 * function makes (e.g. the capacity task delta = 3 requests).
 */

type Opts = Record<string, unknown>;
type Spec = { key: string[]; http: number; opts: Opts; realtime?: "tasks" | "leaves" | "checkins" };

const S = 1000;
const before = (ms: number): Opts => ({ staleTime: ms }); // default refetchOnWindowFocus: true

const CAPACITY_BEFORE: Spec[] = [
  { key: ["capacity-profiles"], http: 2, opts: before(10 * S) },
  { key: ["capacity-tasks"], http: 3, opts: before(10 * S), realtime: "tasks" },
  { key: ["capacity-tasks", "older-count"], http: 1, opts: before(10 * S), realtime: "tasks" },
  { key: ["capacity-teams"], http: 1, opts: before(30 * S) },
  { key: ["capacity-projects"], http: 1, opts: before(30 * S) },
  { key: ["capacity-active-leaves", "d"], http: 1, opts: before(10 * S), realtime: "leaves" },
];
const CAPACITY_AFTER: Spec[] = [
  { key: ["capacity-profiles"], http: 2, opts: slowChanging() },
  { key: ["capacity-tasks"], http: 3, opts: realtimeCovered(), realtime: "tasks" },
  { key: ["capacity-tasks", "older-count"], http: 1, opts: realtimeCovered(), realtime: "tasks" },
  { key: ["capacity-teams"], http: 1, opts: slowChanging() },
  { key: ["capacity-projects"], http: 1, opts: slowChanging() },
  { key: ["capacity-active-leaves", "d"], http: 1, opts: realtimeCovered(), realtime: "leaves" },
];

// Executive: summary (server fn, 6 reads), the task window (delta = 2 requests), people, projects, teams, leaves.
const EXEC_BEFORE: Spec[] = [
  { key: ["eod-widget-profiles"], http: 1, opts: before(30 * S) },
  { key: ["eod-widget-tasks", "r"], http: 2, opts: { ...before(60 * S), refetchOnWindowFocus: false }, realtime: "tasks" },
  { key: ["exec-projects"], http: 1, opts: before(30 * S) },
  { key: ["exec-teams"], http: 1, opts: before(30 * S) },
  { key: ["exec-active-leaves", "d"], http: 1, opts: before(10 * S), realtime: "leaves" },
  { key: ["exec-summary", "r"], http: 6, opts: { ...before(30 * S), refetchOnWindowFocus: false }, realtime: "tasks" },
];
const EXEC_AFTER: Spec[] = [
  { key: ["eod-widget-profiles"], http: 1, opts: slowChanging() },
  { key: ["eod-widget-tasks", "r"], http: 2, opts: realtimeCovered(60 * S), realtime: "tasks" },
  { key: ["exec-projects"], http: 1, opts: slowChanging() },
  { key: ["exec-teams"], http: 1, opts: slowChanging() },
  { key: ["exec-active-leaves", "d"], http: 1, opts: realtimeCovered(), realtime: "leaves" },
  { key: ["exec-summary", "r"], http: 6, opts: realtimeCovered(), realtime: "tasks" },
];

type Run = { http: number; byQuery: Record<string, number> };

/** mount -> 3 tab returns after 60s away -> a burst of 4 task events (250ms apart, the channel throttle) -> 1 leave event. */
async function scenario(specs: Spec[], mode: "before" | "after"): Promise<Run> {
  const counts: Record<string, number> = {};
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(
    () => {
      const client = useQueryClient();
      const scheduler = useRefreshScheduler(client);
      for (const s of specs) {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useQuery({
          queryKey: s.key,
          queryFn: async () => {
            counts[s.key.join("/")] = (counts[s.key.join("/")] ?? 0) + s.http;
            return Date.now();
          },
          ...(s.opts as object),
        });
      }
      return { client, scheduler };
    },
    { wrapper },
  );
  const settle = async (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await settle(10);

  const returnToTab = async () => {
    await act(async () => { focusManager.setFocused(false); });
    await settle(60 * S);
    await act(async () => { focusManager.setFocused(true); });
    await settle(50);
  };
  for (let i = 0; i < 3; i++) await returnToTab();

  const fire = (table: "tasks" | "leaves") => {
    for (const s of specs.filter((x) => x.realtime === table)) {
      // BEFORE: the callbacks called invalidateQueries({ queryKey: <page prefix> }) per event.
      // AFTER: they call scheduler.schedule(<same prefix>).
      const prefix = [s.key[0]];
      if (mode === "before") void hook.result.current.client.invalidateQueries({ queryKey: prefix });
      else hook.result.current.scheduler.schedule(prefix, s.key[0] === "exec-summary" ? 1000 : 300);
    }
  };
  for (let i = 0; i < 4; i++) {
    await act(async () => fire("tasks"));
    await settle(250);
  }
  await settle(2000);
  await act(async () => fire("leaves"));
  await settle(2000);

  hook.unmount();
  qc.clear();
  return { http: Object.values(counts).reduce((a, b) => a + b, 0), byQuery: counts };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  focusManager.setFocused(true);
});
afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("measured request counts (same scenario, old vs new options)", () => {
  const report: string[] = [];
  const row = (name: string, a: Run, b: Run) => {
    const pct = Math.round((1 - b.http / a.http) * 100);
    report.push(`${name}: ${a.http} -> ${b.http} HTTP requests (-${pct}%)`);
  };

  it("Team Capacity makes far fewer requests, and none on tab return", async () => {
    const a = await scenario(CAPACITY_BEFORE, "before");
    const b = await scenario(CAPACITY_AFTER, "after");
    row("Team Capacity", a, b);
    // The initial load is identical (6 queries = 10 requests); the saving is in everything after it.
    expect(b.http).toBeLessThan(a.http);
    expect(b.byQuery["capacity-profiles"]).toBe(2); // loaded once, not on each of 3 returns
    expect(b.byQuery["capacity-teams"]).toBe(1);
    expect(b.byQuery["capacity-projects"]).toBe(1);
    // 4 task events in one burst -> one delta refresh (3 requests) + the initial load (3)
    expect(b.byQuery["capacity-tasks"]).toBe(6);
    expect(a.byQuery["capacity-tasks"]).toBeGreaterThan(b.byQuery["capacity-tasks"]);
    console.log("\n" + report.join("\n"));
  });

  it("Executive makes fewer requests, and the six-query summary refreshes once per burst", async () => {
    const a = await scenario(EXEC_BEFORE, "before");
    const b = await scenario(EXEC_AFTER, "after");
    row("Executive", a, b);
    expect(b.http).toBeLessThan(a.http);
    expect(b.byQuery["exec-summary/r"]).toBe(12); // initial 6 + one refresh of 6
    expect(a.byQuery["exec-summary/r"]).toBeGreaterThan(b.byQuery["exec-summary/r"]);
    expect(b.byQuery["exec-projects"]).toBe(1);
    console.log(report[report.length - 1]);
  });

  it("a realtime change is still picked up (after the burst), and tab return alone refetches nothing", async () => {
    const counts = { n: 0 };
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(
      () => {
        const client = useQueryClient();
        const scheduler = useRefreshScheduler(client);
        const q = useQuery({ queryKey: ["x"], queryFn: async () => ++counts.n, ...realtimeCovered() });
        return { scheduler, q };
      },
      { wrapper },
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(counts.n).toBe(1);
    await act(async () => { focusManager.setFocused(false); await vi.advanceTimersByTimeAsync(5 * 60 * S); focusManager.setFocused(true); await vi.advanceTimersByTimeAsync(50); });
    expect(counts.n).toBe(1); // 5 minutes away, back in the tab: no request
    await act(async () => { result.current.scheduler.schedule(["x"]); result.current.scheduler.schedule(["x"]); await vi.advanceTimersByTimeAsync(400); });
    expect(counts.n).toBe(2); // two events, one refetch, data is new
    expect(result.current.q.data).toBe(2);
    unmount();
  });
});

describe("refresh scheduler", () => {
  it("coalesces per key, keeps keys independent, refetches only active queries, and cancels", async () => {
    const qc = new QueryClient();
    const inv = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    const s = createRefreshScheduler(qc, 100);
    s.schedule(["a"]); s.schedule(["a"]); s.schedule(["b"]);
    await vi.advanceTimersByTimeAsync(150);
    expect(inv).toHaveBeenCalledTimes(2);
    expect(inv).toHaveBeenCalledWith({ queryKey: ["a"] }); // default refetchType: active only
    s.schedule(["a"]); s.cancel();
    await vi.advanceTimersByTimeAsync(500);
    expect(inv).toHaveBeenCalledTimes(2);
  });

  it("the trailing refresh runs after the LAST event, so the newest change is included", async () => {
    const qc = new QueryClient();
    const inv = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    const s = createRefreshScheduler(qc, 300);
    s.schedule(["a"]);
    await vi.advanceTimersByTimeAsync(200);
    s.schedule(["a"]);
    await vi.advanceTimersByTimeAsync(200);
    expect(inv).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(inv).toHaveBeenCalledTimes(1);
  });
});

describe("page source guards (static)", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
  const cap = read("src/routes/_authenticated/team-capacity.tsx");
  const exe = read("src/routes/_authenticated/executive.tsx");

  it("neither page lets a realtime callback or local save call invalidateQueries directly", () => {
    expect(cap).not.toMatch(/invalidateQueries/);
    expect(exe).not.toMatch(/invalidateQueries/);
  });
  it("no query on either page refetches on focus (no explicit staleTime-only queries left)", () => {
    for (const src of [cap, exe]) {
      expect(src).not.toMatch(/staleTime:\s*\d/);
      expect(src).toMatch(/realtimeCovered\(/);
      expect(src).toMatch(/slowChanging\(/);
    }
  });
  it("the global QueryClient defaults are untouched and My Day still opts in to focus refetch", () => {
    expect(read("src/router.tsx")).not.toMatch(/staleTime|refetchOnWindowFocus/);
    expect(read("src/routes/_authenticated/my-day.tsx")).toMatch(/refetchOnWindowFocus:\s*true/);
  });
  it("notification recovery is event-driven: no time-based tab-return refetch, catch-up on reconnect stays", () => {
    const src = read("src/hooks/use-notifications.tsx");
    expect(src).not.toMatch(/visibilitychange|REFOCUS_REFETCH_AFTER_MS/);
    expect(src).toMatch(/onRealtimeResync\(/);
    expect(src).toMatch(/onRealtime<[^>]*>\("notification:read"/);
  });
});

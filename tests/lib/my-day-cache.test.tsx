import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, focusManager, useQuery } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";

// --- supabase channel capture (for the freshness listener's subscriptions) ---
type Sub = { table: string; filter?: string; cb: () => void };
let subs: Sub[] = [];
const removed: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const ch: any = {
        on: (_t: string, o: { table: string; filter?: string }, cb: () => void) => (subs.push({ table: o.table, filter: o.filter, cb }), ch),
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: (c: unknown) => removed.push(c),
  },
}));

import { MY_DAY_KEY, MY_DAY_STALE_MS, MY_DAY_TASKS_KEY, markMyDayStale, useMyDayFreshness } from "@/lib/my-day-cache";

const S = 1000;
const USER = "u1";

/** A fake server whose data has a version, so we can tell whether what the page shows is the latest. */
function makeServer() {
  const s = { version: 1, http: 0, byQuery: {} as Record<string, number> };
  const hit = (name: string, n: number) => {
    s.http += n;
    s.byQuery[name] = (s.byQuery[name] ?? 0) + n;
  };
  return { s, hit };
}

type Mode = "head" | "forced" | "smart";

/**
 * head   = the code before this change (priorities staleTime 30s; my tasks loaded on EVERY mount)
 * forced = refetchOnMount "always" on both (the simple fix: a call on every visit)
 * smart  = this change (fresh data reused; relevant change marks it stale even while the page is closed)
 */
function useMyDay(mode: Mode, server: ReturnType<typeof makeServer>) {
  const tasksKey = [...MY_DAY_TASKS_KEY, USER, "d"] as const;
  const prio = useQuery({
    queryKey: [...MY_DAY_KEY, USER],
    queryFn: async () => (server.hit("my-day", 1), server.s.version),
    staleTime: mode === "head" ? 30 * S : MY_DAY_STALE_MS,
    refetchOnWindowFocus: false, // isolate navigation; focus is covered by staleTime in both
    ...(mode === "forced" ? { refetchOnMount: "always" as const } : {}),
  });
  const tasks = useQuery({
    queryKey: tasksKey,
    queryFn: async () => (server.hit("my-day-tasks", 2), server.s.version), // tasks+worklogs and the completed count
    staleTime: mode === "head" ? 0 : MY_DAY_STALE_MS, // head: a state copy reloaded on every mount (modelled as stale 0)
    refetchOnWindowFocus: false,
    ...(mode === "forced" ? { refetchOnMount: "always" as const } : {}),
  });
  return { prio: prio.data, tasks: tasks.data };
}

async function scenario(mode: Mode) {
  const server = makeServer();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const settle = async (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  let staleReturns = 0;
  const visit = async () => {
    const hook = renderHook(() => useMyDay(mode, server), { wrapper });
    await settle(50);
    // What is on screen once the visit has settled: is it the latest server version?
    if (hook.result.current.prio !== server.s.version || hook.result.current.tasks !== server.s.version) staleReturns += 1;
    return hook;
  };

  let hook = await visit(); // first load: 3 requests
  for (let i = 1; i <= 5; i++) {
    hook.unmount(); // navigate to the Tasks page
    await settle(10 * S);
    if (i === 2) {
      server.s.version += 1; // a relevant change happens while My Day is closed
      if (mode === "smart") markMyDayStale(qc); // what useMyDayFreshness does when the event arrives
    }
    hook = await visit(); // navigate back
  }
  hook.unmount();
  qc.clear();
  return { http: server.s.http, staleReturns, byQuery: server.s.byQuery };
}

beforeEach(() => {
  subs = [];
  removed.length = 0;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  focusManager.setFocused(true);
});
afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe("My Day navigation: measured requests (1 first load + 5 round trips to the Tasks page, one relevant change)", () => {
  it("fresh data is reused, a relevant change refetches exactly once, and what you see is never stale", async () => {
    const head = await scenario("head");
    const forced = await scenario("forced");
    const smart = await scenario("smart");
    console.log(
      `\nBefore (HEAD):            ${head.http} HTTP requests, ${head.staleReturns} stale returns` +
        `\nForced refetch on mount:  ${forced.http} HTTP requests, ${forced.staleReturns} stale returns` +
        `\nSmart cache (this change): ${smart.http} HTTP requests, ${smart.staleReturns} stale returns`,
    );
    // Smart: the first load (1 + 2 requests) plus ONE refresh of both after the relevant change (1 + 2).
    expect(smart.byQuery["my-day"]).toBe(2);
    expect(smart.byQuery["my-day-tasks"]).toBe(4);
    expect(smart.http).toBe(6);
    expect(smart.staleReturns).toBe(0);
    // It never costs more than the old code or the forced fix, and the old code showed stale data.
    expect(smart.http).toBeLessThan(head.http);
    expect(smart.http).toBeLessThan(forced.http);
    expect(head.staleReturns).toBeGreaterThan(0);
  });

  it("with no change at all, returning to My Day makes no request", async () => {
    const server = makeServer();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    let hook = renderHook(() => useMyDay("smart", server), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(server.s.http).toBe(3);
    for (let i = 0; i < 4; i++) {
      hook.unmount();
      await act(async () => { await vi.advanceTimersByTimeAsync(20 * S); });
      hook = renderHook(() => useMyDay("smart", server), { wrapper });
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    }
    expect(server.s.http).toBe(3);
    hook.unmount();
  });

  it("data older than the stale time is refetched on return (safety net if an event was missed)", async () => {
    const server = makeServer();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    let hook = renderHook(() => useMyDay("smart", server), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    hook.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(MY_DAY_STALE_MS + 1000); });
    hook = renderHook(() => useMyDay("smart", server), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(server.s.http).toBe(6);
    hook.unmount();
  });

  it("marking stale makes no request while the page is closed", async () => {
    const server = makeServer();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useMyDay("smart", server), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    hook.unmount();
    const before = server.s.http;
    for (let i = 0; i < 10; i++) markMyDayStale(qc);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(server.s.http).toBe(before);
  });
});

describe("useMyDayFreshness subscriptions", () => {
  const wrap = (qc: QueryClient) => ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

  it("a member hears tasks, worklogs, review decisions and approvals (the server already routes only theirs)", () => {
    const qc = new QueryClient();
    renderHook(() => useMyDayFreshness(USER, false), { wrapper: wrap(qc) });
    expect(subs.map((s) => `${s.table}|${s.filter ?? ""}`).sort()).toEqual(
      ["approval_requests|", "task_review_decisions|", "task_worklogs|", "tasks|"].sort(),
    );
  });

  it("a manager narrows tasks / worklogs / decisions to rows naming them, and also hears risk events", () => {
    const qc = new QueryClient();
    renderHook(() => useMyDayFreshness(USER, true), { wrapper: wrap(qc) });
    const keys = subs.map((s) => `${s.table}|${s.filter ?? ""}`);
    expect(keys).toContain(`tasks|assigned_to=eq.${USER}`);
    expect(keys).toContain(`tasks|reviewer=eq.${USER}`);
    expect(keys).toContain(`task_worklogs|user_id=eq.${USER}`);
    expect(keys).toContain(`task_review_decisions|reviewer_id=eq.${USER}`);
    expect(keys).toContain("risk_events|");
    expect(keys).toContain("approval_requests|");
    expect(keys).not.toContain("tasks|"); // never "every task in the company"
  });

  it("an event marks both caches stale WITHOUT fetching, and nothing subscribes without a user", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    renderHook(() => useMyDayFreshness(undefined, false), { wrapper: wrap(qc) });
    expect(subs).toHaveLength(0);
    renderHook(() => useMyDayFreshness(USER, false), { wrapper: wrap(qc) });
    subs[0].cb();
    expect(spy).toHaveBeenCalledWith({ queryKey: MY_DAY_KEY, refetchType: "none" });
    expect(spy).toHaveBeenCalledWith({ queryKey: MY_DAY_TASKS_KEY, refetchType: "none" });
  });

  it("unsubscribes on unmount", () => {
    const qc = new QueryClient();
    const h = renderHook(() => useMyDayFreshness(USER, false), { wrapper: wrap(qc) });
    h.unmount();
    expect(removed).toHaveLength(1);
  });
});

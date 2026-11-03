import { beforeEach, describe, expect, it, vi } from "vitest";

const select = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select }) },
}));
let authCb: ((event: string, s: { user?: { id: string } } | null) => void) | null = null;
vi.mock("@/integrations/backend/auth", () => ({
  auth: {
    onAuthStateChange: (cb: typeof authCb) => {
      authCb = cb;
      return { data: { subscription: { unsubscribe() {} } } };
    },
  },
}));

const rows = [{ id: "a", display_name: "A", avatar_url: null, email: "a@x", team_id: null, manager_id: null }];

async function fresh() {
  vi.resetModules();
  authCb = null;
  return await import("@/lib/people");
}

beforeEach(() => {
  select.mockReset();
  select.mockResolvedValue({ data: rows, error: null });
  vi.useRealTimers();
  (globalThis as any).window = globalThis;
});

describe("people cache", () => {
  it("shares simultaneous requests", async () => {
    const p = await fresh();
    await Promise.all([p.loadPeople(), p.loadPeople(), p.loadPeopleSafe()]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("reuses a fresh result and refetches after the TTL", async () => {
    vi.useFakeTimers();
    const p = await fresh();
    await p.loadPeople();
    await p.loadPeople();
    expect(select).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(p.PEOPLE_TTL_MS + 1);
    await p.loadPeople();
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("serves the basic list from a fresh detailed one", async () => {
    const p = await fresh();
    await p.loadPeopleDetailed();
    const basic = await p.loadPeople();
    expect(select).toHaveBeenCalledTimes(1);
    expect(basic[0]).toEqual({ id: "a", display_name: "A", avatar_url: null });
  });

  it("invalidatePeople forces a refetch", async () => {
    const p = await fresh();
    await p.loadPeople();
    p.invalidatePeople();
    await p.loadPeople();
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("hands each caller its own array", async () => {
    const p = await fresh();
    const a = await p.loadPeople();
    a.length = 0;
    expect((await p.loadPeople()).length).toBe(1);
  });

  it("keeps the last good list when a refetch fails, and does not cache the failure", async () => {
    const p = await fresh();
    await p.loadPeople();
    p.invalidatePeople(); // drops lastGood too, so re-prime then expire via a failing detailed->basic path
    select.mockResolvedValueOnce({ data: rows, error: null });
    await p.loadPeople();
    select.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    vi.useFakeTimers();
    vi.advanceTimersByTime(p.PEOPLE_TTL_MS + 1);
    expect((await p.loadPeople()).length).toBe(1);
    select.mockResolvedValueOnce({ data: rows, error: null });
    await p.loadPeople();
    expect(select).toHaveBeenCalledTimes(4);
  });

  it("rejects on first failure, and Safe resolves to []", async () => {
    const p = await fresh();
    select.mockResolvedValue({ data: null, error: new Error("boom") });
    await expect(p.loadPeople()).rejects.toThrow("boom");
    expect(await p.loadPeopleSafe()).toEqual([]);
  });

  it("drops the cache on sign-out or a different user, not on a repeated sign-in", async () => {
    const p = await fresh();
    await p.loadPeople();
    authCb!("SIGNED_IN", { user: { id: "u1" } });
    authCb!("SIGNED_IN", { user: { id: "u1" } });
    await p.loadPeople();
    expect(select).toHaveBeenCalledTimes(1);
    authCb!("SIGNED_IN", { user: { id: "u2" } });
    await p.loadPeople();
    expect(select).toHaveBeenCalledTimes(2);
    authCb!("SIGNED_OUT", null);
    await p.loadPeople();
    expect(select).toHaveBeenCalledTimes(3);
  });
});

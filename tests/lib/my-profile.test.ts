import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// One page load used to read profiles?id=eq.<me> three times (app shell, My Day, morning prompt),
// each with a different column list. They now share one read of the superset of those columns.

const queries: Array<{ table: string; cols: string; col: string; val: unknown }> = [];
let result: { data: unknown; error: unknown } = { data: null, error: null };
let gate: Promise<void> | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, val: unknown) => ({
          maybeSingle: async () => {
            queries.push({ table, cols, col, val });
            if (gate) await gate;
            return result;
          },
        }),
      }),
    }),
  },
}));

import { PROFILE_SHARE_MS, invalidateMyProfile, loadMyProfile } from "@/lib/my-profile";

const ME = { display_name: "Nirav", email: "n@x.test", avatar_url: null };

beforeEach(() => {
  vi.useFakeTimers();
  queries.length = 0;
  gate = null;
  result = { data: ME, error: null };
  invalidateMyProfile();
});
afterEach(() => vi.useRealTimers());

describe("loadMyProfile", () => {
  it("callers that ask at the same time share ONE request (app shell + My Day + morning prompt)", async () => {
    const [a, b, c] = await Promise.all([loadMyProfile("u1"), loadMyProfile("u1"), loadMyProfile("u1")]);
    expect(queries).toHaveLength(1);
    expect(a).toEqual(ME);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("reads exactly the superset of the columns the three callers used, for my row only", async () => {
    await loadMyProfile("u1");
    expect(queries[0]).toEqual({ table: "profiles", cols: "display_name, email, avatar_url", col: "id", val: "u1" });
  });

  it("joins a request that is still in flight", async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const a = loadMyProfile("u1");
    vi.advanceTimersByTime(1000); // a slow first request: a later caller still joins it
    const b = loadMyProfile("u1");
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(queries).toHaveLength(1);
    expect(rb).toBe(ra);
  });

  it("a finished result is reused only briefly, so a renamed profile shows up on the next mount", async () => {
    await loadMyProfile("u1");
    vi.advanceTimersByTime(PROFILE_SHARE_MS - 100);
    await loadMyProfile("u1");
    expect(queries).toHaveLength(1);
    vi.advanceTimersByTime(200);
    result = { data: { ...ME, display_name: "Renamed" }, error: null };
    expect((await loadMyProfile("u1"))?.display_name).toBe("Renamed");
    expect(queries).toHaveLength(2);
  });

  it("is per user: another user never gets the first user's profile", async () => {
    await loadMyProfile("u1");
    result = { data: { ...ME, display_name: "Someone else" }, error: null };
    expect((await loadMyProfile("u2"))?.display_name).toBe("Someone else");
    expect(queries).toHaveLength(2);
  });

  it("returns null on a read error or a missing row, and does not remember it (the next caller retries)", async () => {
    result = { data: null, error: { message: "boom" } };
    expect(await loadMyProfile("u1")).toBeNull();
    result = { data: ME, error: null };
    expect(await loadMyProfile("u1")).toEqual(ME);
    expect(queries).toHaveLength(2);

    invalidateMyProfile();
    queries.length = 0;
    result = { data: null, error: null }; // no profile row yet
    expect(await loadMyProfile("u1")).toBeNull();
    expect(await loadMyProfile("u1")).toBeNull();
    expect(queries).toHaveLength(2);
  });

  it("invalidateMyProfile forces the next call to read again", async () => {
    await loadMyProfile("u1");
    invalidateMyProfile();
    await loadMyProfile("u1");
    expect(queries).toHaveLength(2);
  });
});

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const poke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/realtime/socket", () => ({
  pokeRealtime: poke,
  onRealtime: () => () => {},
  onRealtimeConnect: () => () => {},
  isRealtimeConnected: () => true,
}));
vi.mock("@/integrations/backend/auth", () => ({ auth: {} }));

type Sb = typeof import("@/integrations/supabase/client").supabase;
let supabase: Sb;
const realFetch = globalThis.fetch;
let status = 200;
const calls: Array<{ url: string; method: string }> = [];

beforeAll(async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://postgrest.test");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
  supabase = (await import("@/integrations/supabase/client")).supabase;
});
beforeEach(() => {
  poke.mockClear();
  calls.length = 0;
  status = 200;
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method ?? "GET").toUpperCase() });
    return new Response("[]", { status, headers: { "content-type": "application/json" } });
  }) as never;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("browser client pokes the server after a successful write", () => {
  it("reads never poke", async () => {
    await supabase.from("tasks").select("*");
    expect(calls[0].method).toBe("GET");
    expect(poke).not.toHaveBeenCalled();
  });

  it("insert (POST), update (PATCH) and delete (DELETE) each poke once", async () => {
    await supabase.from("tasks").insert({ task_name: "x" } as never);
    await supabase.from("tasks").update({ task_name: "y" } as never).eq("id", "1");
    await supabase.from("tasks").delete().eq("id", "1");
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH", "DELETE"]);
    expect(poke).toHaveBeenCalledTimes(3);
  });

  it("an RPC (POST) counts as a write", async () => {
    await supabase.rpc("some_function" as never);
    expect(poke).toHaveBeenCalledTimes(1);
  });

  it("a FAILED write does not poke (nothing changed)", async () => {
    status = 403;
    await supabase.from("tasks").update({ task_name: "y" } as never).eq("id", "1");
    status = 500;
    await supabase.from("tasks").insert({ task_name: "x" } as never);
    expect(poke).not.toHaveBeenCalled();
  });

  it("the response is passed through unchanged (data still reaches the caller)", async () => {
    const { data, error } = await supabase.from("tasks").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

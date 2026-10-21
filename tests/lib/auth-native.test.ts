/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSecureStore = vi.fn();

vi.mock("@/lib/secure-storage", () => ({ getSecureStore: () => getSecureStore() }));
vi.mock("keycloak-js", () => ({
  default: class {
    authServerUrl = "https://auth.example";
    init = vi.fn(async () => false);
    login = vi.fn();
    register = vi.fn();
    logout = vi.fn();
    updateToken = vi.fn();
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({})) },
}));

function memStore(initial: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(initial));
  return {
    m,
    get: vi.fn(async (k: string) => m.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => void m.set(k, v)),
    remove: vi.fn(async (k: string) => void m.delete(k)),
  };
}

function jwt(secondsFromNow: number) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=/g, "");
  const exp = Math.floor(Date.now() / 1000) + secondsFromNow;
  return `${b64({ alg: "none" })}.${b64({ sub: "u1", email: "a@b.c", exp })}.sig`;
}

const okGrant = (rt = "rt-new") =>
  new Response(JSON.stringify({ access_token: jwt(3600), refresh_token: rt }), { status: 200 });
const errGrant = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status });

async function load(store: ReturnType<typeof memStore>) {
  getSecureStore.mockReturnValue(store);
  vi.resetModules();
  return (await import("@/integrations/backend/auth")) as typeof import("@/integrations/backend/auth");
}

beforeEach(() => {
  vi.stubEnv("VITE_NATIVE_PERSISTENT_LOGIN", "true");
  getSecureStore.mockReset();
  window.localStorage.clear();
  window.localStorage.setItem("kc_client", "operon-app");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete (navigator as any).locks;
});

describe("startup network failures", () => {
  it("keeps the refresh token and does not wipe storage when the server is unreachable", async () => {
    vi.useFakeTimers();
    const store = memStore({ refresh_token: "rt" });
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    globalThis.fetch = fetchMock as never;
    const auth = await load(store);

    const started = auth.initKeycloak();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await started).toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 backoff retries
    expect(store.m.get("refresh_token")).toBe("rt");
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("keeps the user signed in on a still-valid cached access token", async () => {
    vi.useFakeTimers();
    const store = memStore({ refresh_token: "rt" });
    const cached = jwt(30); // usable, but inside the 70s refresh window
    window.localStorage.setItem("kc_token", cached);
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("offline");
    }) as never;
    const auth = await load(store);

    const started = auth.initKeycloak();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await started).toBe(true);
    expect(window.localStorage.getItem("kc_token")).toBe(cached);
    expect(store.m.get("refresh_token")).toBe("rt");
  });

  it("treats 5xx and non-invalid_grant 4xx as transient (token kept)", async () => {
    for (const res of [
      () => new Response("oops", { status: 503 }),
      () => errGrant(400, "unauthorized_client"),
      () => errGrant(401, "invalid_client"),
    ]) {
      vi.useFakeTimers();
      const store = memStore({ refresh_token: "rt" });
      globalThis.fetch = vi.fn(async () => res()) as never;
      const auth = await load(store);
      const started = auth.initKeycloak();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await started).toBe(false);
      expect(store.m.get("refresh_token")).toBe("rt");
      vi.useRealTimers();
    }
  });

  it("recovers after a failed start: the UI gets SIGNED_IN", async () => {
    vi.useFakeTimers();
    const store = memStore({ refresh_token: "rt" });
    let up = false;
    globalThis.fetch = vi.fn(async () => {
      if (!up) throw new TypeError("offline");
      return okGrant("rt2");
    }) as never;
    const auth = await load(store);
    const events: string[] = [];
    auth.auth.onAuthStateChange((e) => void events.push(e));

    const started = auth.initKeycloak();
    await vi.advanceTimersByTimeAsync(10_000);
    await started;
    expect(events).toContain("SIGNED_OUT");

    up = true;
    await auth.refreshSessionNow();
    expect(events.at(-1)).toBe("SIGNED_IN");
    expect(store.m.get("refresh_token")).toBe("rt2");
  });
});

describe("invalid_grant", () => {
  it("clears the session and signs out only on invalid_grant", async () => {
    const store = memStore({ refresh_token: "dead" });
    window.localStorage.setItem("kc_token", jwt(10));
    globalThis.fetch = vi.fn(async () => errGrant(400, "invalid_grant")) as never;
    const auth = await load(store);
    const events: string[] = [];
    auth.auth.onAuthStateChange((e) => void events.push(e));

    expect(await auth.initKeycloak()).toBe(false);
    expect(store.remove).toHaveBeenCalledWith("refresh_token");
    expect(store.m.has("refresh_token")).toBe(false);
    expect(window.localStorage.getItem("kc_token")).toBeNull();
    expect(events).toContain("SIGNED_OUT");
  });
});

describe("cross-window refresh coordination", () => {
  it("two windows refreshing at once perform a single token grant", async () => {
    let chain: Promise<unknown> = Promise.resolve();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: (_name: string, fn: () => Promise<unknown>) => {
          const run = chain.then(() => fn());
          chain = run.catch(() => undefined);
          return run;
        },
      },
    });
    const store = memStore({ refresh_token: "rt" });
    const fetchMock = vi.fn(async () => okGrant("rt-next"));
    globalThis.fetch = fetchMock as never;

    const windowA = await load(store);
    const windowB = await load(store); // separate module instance = separate window

    const [a, b] = await Promise.all([windowA.initKeycloak(), windowB.initKeycloak()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.m.get("refresh_token")).toBe("rt-next");
  });
});

describe("pending logout revocation", () => {
  it("keeps a pending revoke when offline and finishes it on next start", async () => {
    const store = memStore({ refresh_token: "rt" });
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("offline");
    }) as never;
    const first = await load(store);
    await first.auth.signOut();

    expect(store.m.has("refresh_token")).toBe(false);
    expect(store.m.get("pending_revoke")).toBe("rt");

    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response("", { status: 200 });
    }) as never;
    const second = await load(store);
    await second.initKeycloak();
    await vi.waitFor(() => expect(store.m.has("pending_revoke")).toBe(false));
    expect(calls.some((u) => u.endsWith("/openid-connect/revoke"))).toBe(true);
  });

  it("does not leave a pending revoke after a successful logout", async () => {
    const store = memStore({ refresh_token: "rt" });
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200 })) as never;
    const auth = await load(store);
    await auth.auth.signOut();
    expect(store.m.size).toBe(0);
  });
});

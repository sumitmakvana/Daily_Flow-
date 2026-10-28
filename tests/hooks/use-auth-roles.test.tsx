import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { createElement } from "react";

// Controllable stand-in for the Keycloak auth wrapper.
type Listener = (event: string, session: unknown) => void;
const listeners = new Set<Listener>();
let currentSession: unknown = null;
// The real Keycloak wrapper calls every NEW subscriber right away with the current session
// ("initial session"). Tests flip this on to reproduce that.
let immediateSignedIn = false;
const sessionFor = (id: string | null) =>
  id ? { user: { id, email: `${id}@x`, created_at: new Date().toISOString() } } : null; // new object every call

vi.mock("@/integrations/backend/auth", () => ({
  auth: {
    onAuthStateChange: (cb: Listener) => {
      listeners.add(cb);
      if (immediateSignedIn) queueMicrotask(() => cb("SIGNED_IN", currentSession));
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    getSession: async () => ({ data: { session: currentSession } }),
    signOut: vi.fn(async () => ({})),
  },
}));
vi.mock("@/integrations/realtime/socket", () => ({ stopRealtime: vi.fn() }));

const getMyRoles = vi.fn<() => Promise<string[]>>();
vi.mock("@/services/auth.functions", () => ({ getMyRoles: () => getMyRoles() }));

import { ROLES_TTL_MS, getRolesShared, invalidateRoles, signOut, useAuth } from "@/hooks/use-auth";

const seen: Array<ReturnType<typeof useAuth>> = [];
function Probe() {
  seen.push(useAuth());
  return null;
}
const mountMany = (n: number) => render(createElement("div", null, Array.from({ length: n }, (_, i) => createElement(Probe, { key: i }))));
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const emit = (event: string, id: string | null) =>
  act(async () => {
    currentSession = sessionFor(id);
    listeners.forEach((cb) => cb(event, currentSession));
    await Promise.resolve();
    await Promise.resolve();
  });

beforeEach(() => {
  immediateSignedIn = false;
  invalidateRoles();
  listeners.clear();
  seen.length = 0;
  getMyRoles.mockReset();
  getMyRoles.mockResolvedValue(["manager"]);
  currentSession = sessionFor("u1");
});
afterEach(() => vi.useRealTimers());

describe("useAuth role loading is shared", () => {
  it("many consumers cause ONE user_roles fetch, not one (or several) each", async () => {
    mountMany(40);
    await flush();
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)!.isManager).toBe(true);
  });

  it("auth events that only change the user object's identity do not refetch per component", async () => {
    mountMany(40);
    await flush();
    await flush();
    getMyRoles.mockClear();
    // Same user, fresh object each time (this is what getSessionSync() produces).
    await emit("TOKEN_REFRESHED", "u1");
    await emit("TOKEN_REFRESHED", "u1");
    // At most one shared refetch per event (roles are re-read on refresh), never 40.
    expect(getMyRoles.mock.calls.length).toBeLessThanOrEqual(2);
    expect(seen.at(-1)!.isManager).toBe(true);
  });

  it("remounting components (tab switch / filter change) reuses the cached roles", async () => {
    const first = mountMany(24);
    await flush();
    await flush();
    first.unmount();
    getMyRoles.mockClear();
    for (let i = 0; i < 6; i++) {
      const r = mountMany(24);
      await flush();
      r.unmount();
    }
    expect(getMyRoles).not.toHaveBeenCalled();
  });

  it("the cache expires, so a changed role is picked up by the next mount", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const first = mountMany(3);
    await flush();
    await flush();
    first.unmount();
    getMyRoles.mockResolvedValue(["admin"]);
    vi.setSystemTime(Date.now() + ROLES_TTL_MS + 1000);
    mountMany(3);
    await flush();
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)!.isAdmin).toBe(true);
  });

  it("switching users loads that user's roles", async () => {
    mountMany(5);
    await flush();
    await flush();
    getMyRoles.mockResolvedValue(["member"]);
    await emit("SIGNED_IN", "u2");
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(2);
    const last = seen.at(-1)!;
    expect(last.user?.id).toBe("u2");
    expect(last.isManager).toBe(false);
  });

  it("sign-out clears roles and drops the cache", async () => {
    mountMany(5);
    await flush();
    await flush();
    await emit("SIGNED_OUT", null);
    await flush();
    expect(seen.at(-1)!.roles).toEqual([]);
    expect(seen.at(-1)!.isManager).toBe(false);
    // Signing back in as the same user must refetch, not reuse the old entry.
    getMyRoles.mockClear();
    getMyRoles.mockResolvedValue(["member"]);
    await emit("SIGNED_IN", "u1");
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)!.isManager).toBe(false);
  });

  it("signOut() drops the cache", async () => {
    mountMany(2);
    await flush();
    await flush();
    await signOut();
    getMyRoles.mockClear();
    mountMany(2);
    await flush();
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(1);
  });

  it("a failed or empty roles result is not cached", async () => {
    getMyRoles.mockResolvedValueOnce([]);
    const r = mountMany(3);
    await flush();
    await flush();
    r.unmount();
    getMyRoles.mockClear();
    getMyRoles.mockResolvedValue(["manager"]);
    mountMany(3);
    await flush();
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)!.isManager).toBe(true);
  });
});

describe("the wrapper's immediate SIGNED_IN for every new subscriber (K1 root cause)", () => {
  it("does not wipe the shared roles: components mounting later reuse the cached result", async () => {
    immediateSignedIn = true;
    const first = mountMany(5);
    await flush();
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(1);
    // More components mount over time (route change, lazily rendered cards). Each one is told
    // "SIGNED_IN" immediately; none of them may trigger a refetch.
    for (let i = 0; i < 4; i++) {
      mountMany(10);
      await flush();
      await flush();
    }
    first.unmount();
    expect(getMyRoles).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)!.isManager).toBe(true);
  });

  it("still refetches when the signed-in user really changes", async () => {
    immediateSignedIn = true;
    mountMany(3);
    await flush();
    await flush();
    getMyRoles.mockResolvedValue(["member"]);
    await emit("SIGNED_IN", "u2");
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)!.isManager).toBe(false);
  });

  it("a SIGNED_IN for the same, already-cached user is not a change", async () => {
    mountMany(3);
    await flush();
    await flush();
    getMyRoles.mockClear();
    await emit("SIGNED_IN", "u1");
    await emit("SIGNED_IN", "u1");
    await flush();
    expect(getMyRoles).not.toHaveBeenCalled();
  });

  it("sign-out and token refresh still drop the cache (authorization is not weakened)", async () => {
    mountMany(3);
    await flush();
    await flush();
    getMyRoles.mockClear();
    await emit("TOKEN_REFRESHED", "u1");
    await flush();
    expect(getMyRoles.mock.calls.length).toBe(1); // one shared refetch for all instances
    await emit("SIGNED_OUT", null);
    expect(seen.at(-1)!.roles).toEqual([]);
  });
});

describe("getRolesShared (used by the route layout gate)", () => {
  it("joins a request that is already in flight instead of starting another", async () => {
    let release!: (v: string[]) => void;
    getMyRoles.mockImplementationOnce(() => new Promise<string[]>((r) => (release = r)));
    const a = getRolesShared("u1", 0);
    const b = getRolesShared("u1", 0);
    release(["manager"]);
    expect(await a).toEqual(["manager"]);
    expect(await b).toEqual(["manager"]);
    expect(getMyRoles).toHaveBeenCalledTimes(1);
  });

  it("maxAge 0 always reads fresh once the previous read has finished (a gate re-checks every navigation)", async () => {
    await getRolesShared("u1", 0);
    getMyRoles.mockResolvedValue(["member"]);
    expect(await getRolesShared("u1", 0)).toEqual(["member"]); // demoted: the gate sees it immediately
    expect(getMyRoles).toHaveBeenCalledTimes(2);
  });

  it("components that mount right after the gate reuse its result (default window)", async () => {
    await getRolesShared("u1", 0); // the layout's read
    mountMany(20); // AppShell, task cards, ...
    await flush();
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(1);
  });

  it("is per user: a different user never gets someone else's roles", async () => {
    await getRolesShared("u1", 0);
    getMyRoles.mockResolvedValue(["admin"]);
    expect(await getRolesShared("u2")).toEqual(["admin"]);
    expect(getMyRoles).toHaveBeenCalledTimes(2);
  });
});

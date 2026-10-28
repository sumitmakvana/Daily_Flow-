import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { createElement } from "react";

// Controllable stand-in for the Keycloak auth wrapper.
type Listener = (event: string, session: unknown) => void;
const listeners = new Set<Listener>();
let currentSession: unknown = null;
const sessionFor = (id: string | null) =>
  id ? { user: { id, email: `${id}@x`, created_at: new Date().toISOString() } } : null; // new object every call

vi.mock("@/integrations/backend/auth", () => ({
  auth: {
    onAuthStateChange: (cb: Listener) => {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    getSession: async () => ({ data: { session: currentSession } }),
    signOut: vi.fn(async () => ({})),
  },
}));
vi.mock("@/integrations/realtime/socket", () => ({ stopRealtime: vi.fn() }));

const getMyRoles = vi.fn<() => Promise<string[]>>();
vi.mock("@/services/auth.functions", () => ({ getMyRoles: () => getMyRoles() }));

import { ROLES_TTL_MS, invalidateRoles, signOut, useAuth } from "@/hooks/use-auth";

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

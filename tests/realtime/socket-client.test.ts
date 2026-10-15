// @vitest-environment node
// Real socket.io client singleton <-> real realtime.server, with only the
// Keycloak verification, Postgres and the Keycloak auth module mocked.
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const inSeconds = (n: number) => Math.floor(Date.now() / 1000) + n;

vi.mock("@/integrations/backend/jwt.server", () => ({
  verifyBackendJwt: async (token: string) => {
    const [sub, exp] = token.split(":");
    if (!sub || !exp || sub === "bad" || Number(exp) * 1000 < Date.now()) throw new Error("invalid");
    return { sub, exp: Number(exp) };
  },
}));
const dbState = vi.hoisted(() => ({ fail: false }));
vi.mock("@/integrations/postgres/client.server", () => ({
  getPool: () => ({
    query: async () => {
      if (dbState.fail) throw new Error("db down");
      return { rows: [] };
    },
  }),
}));

// Controllable stand-in for the Keycloak auth module.
const authListeners = new Set<(e: string, s: unknown) => void>();
vi.mock("@/integrations/backend/auth", () => ({
  auth: {
    onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
      authListeners.add(cb);
      return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
    },
  },
}));
const fireAuth = (e: string) => authListeners.forEach((cb) => cb(e, {}));

import { attachRealtime, emitToUser, setPokeHandler } from "@/lib/realtime.server";

let http: HttpServer;
let store: Record<string, string> = {};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean, ms = 6000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("timeout waiting for condition");
    await wait(25);
  }
};

let rt: typeof import("@/integrations/realtime/socket");

beforeAll(async () => {
  http = createServer((_q, r) => r.end("app"));
  attachRealtime(http);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const port = (http.address() as AddressInfo).port;
  // Minimal browser globals for socket.io-client + our module.
  const loc = { protocol: "http:", host: `127.0.0.1:${port}`, hostname: "127.0.0.1", port: String(port), href: `http://127.0.0.1:${port}/` };
  (globalThis as any).window = {
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v), removeItem: (k: string) => delete store[k] },
    location: loc,
  };
  (globalThis as any).location = loc;
});
afterAll(async () => {
  rt?.__resetRealtimeForTests();
  await new Promise((r) => http.close(r));
});
beforeEach(async () => {
  store = {};
  vi.resetModules();
  rt = await import("@/integrations/realtime/socket");
  rt.__resetRealtimeForTests();
});

describe("frontend socket client", () => {
  it("connects with the stored token and receives user events", async () => {
    store.kc_token = `alice:${inSeconds(60)}`;
    const got: unknown[] = [];
    rt.onRealtime("notification:new", (p) => got.push(p));
    rt.startRealtime();
    await until(() => rt.isRealtimeConnected());
    emitToUser("alice", "notification:new", { id: "n1" });
    emitToUser("bob", "notification:new", { id: "other" });
    await until(() => got.length > 0);
    await wait(100);
    expect(got).toEqual([{ id: "n1" }]);
    rt.stopRealtime();
  });

  it("does not connect without a token; connects on SIGNED_IN once one exists (login)", async () => {
    rt.startRealtime();
    await wait(300);
    expect(rt.isRealtimeConnected()).toBe(false);
    store.kc_token = `alice:${inSeconds(60)}`;
    fireAuth("SIGNED_IN");
    await until(() => rt.isRealtimeConnected());
    rt.stopRealtime();
  });

  it("retries after an unauthorized rejection and succeeds once the token is refreshed", async () => {
    store.kc_token = `bad:${inSeconds(60)}`;
    rt.startRealtime();
    await wait(500);
    expect(rt.isRealtimeConnected()).toBe(false);
    store.kc_token = `alice:${inSeconds(60)}`; // Keycloak refreshed it
    await until(() => rt.isRealtimeConnected(), 8000); // 2s backoff retry
    rt.stopRealtime();
  }, 15000);

  it("retries with backoff after the server refuses with 'unavailable' (roles unreadable), then connects", async () => {
    store.kc_token = `alice:${inSeconds(60)}`;
    dbState.fail = true;
    rt.startRealtime();
    await wait(600);
    expect(rt.isRealtimeConnected()).toBe(false);
    dbState.fail = false; // database is back
    await until(() => rt.isRealtimeConnected(), 8000);
    rt.stopRealtime();
  }, 15000);

  it("SIGNED_OUT / stopRealtime disconnects and stops receiving", async () => {
    store.kc_token = `alice:${inSeconds(60)}`;
    const got: unknown[] = [];
    rt.onRealtime("notification:new", (p) => got.push(p));
    rt.startRealtime();
    await until(() => rt.isRealtimeConnected());
    fireAuth("SIGNED_OUT");
    await until(() => !rt.isRealtimeConnected());
    emitToUser("alice", "notification:new", { id: "after-logout" });
    await wait(200);
    expect(got).toEqual([]);
    rt.stopRealtime();
  });

  it("TOKEN_REFRESHED keeps a short-lived token's socket alive past the old expiry", async () => {
    store.kc_token = `alice:${inSeconds(2)}`;
    rt.startRealtime();
    await until(() => rt.isRealtimeConnected());
    store.kc_token = `alice:${inSeconds(60)}`;
    fireAuth("TOKEN_REFRESHED");
    await wait(3000); // beyond the original 2s expiry
    expect(rt.isRealtimeConnected()).toBe(true);
    rt.stopRealtime();
  }, 10000);

  it("reconnects automatically after the server drops it for an expired token", async () => {
    store.kc_token = `alice:${inSeconds(2)}`;
    let connects = 0;
    rt.onRealtimeConnect(() => connects++);
    rt.startRealtime();
    await until(() => rt.isRealtimeConnected());
    store.kc_token = `alice:${inSeconds(60)}`; // refreshed, but no refresh event sent
    await until(() => !rt.isRealtimeConnected(), 5000); // server expiry drop
    await until(() => rt.isRealtimeConnected(), 8000); // backoff reconnect with new token
    expect(connects).toBeGreaterThanOrEqual(2);
    rt.stopRealtime();
  }, 20000);

  it("pokeRealtime reaches the server once connected, is throttled, and is a no-op while disconnected", async () => {
    const handler = vi.fn();
    setPokeHandler(handler);
    try {
      rt.pokeRealtime(); // not started, not connected: nothing happens
      await wait(100);
      expect(handler).not.toHaveBeenCalled();

      store.kc_token = `alice:${inSeconds(60)}`;
      rt.startRealtime();
      await until(() => rt.isRealtimeConnected());
      for (let i = 0; i < 60; i++) rt.pokeRealtime(); // e.g. 60 quick writes
      await wait(800);
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(handler.mock.calls.length).toBeLessThanOrEqual(3); // leading + trailing, not 60

      const before = handler.mock.calls.length;
      await wait(400);
      rt.pokeRealtime(); // a later, separate write goes through
      await wait(200);
      expect(handler.mock.calls.length).toBe(before + 1);

      rt.stopRealtime();
      await until(() => !rt.isRealtimeConnected());
      const after = handler.mock.calls.length;
      rt.pokeRealtime(); // after logout: nothing
      await wait(300);
      expect(handler.mock.calls.length).toBe(after);
    } finally {
      setPokeHandler(null);
      rt.stopRealtime();
    }
  });

  it("reports isReconnect=true only after the first connect", async () => {
    store.kc_token = `alice:${inSeconds(60)}`;
    const flags: boolean[] = [];
    rt.onRealtimeConnect((r) => flags.push(r));
    rt.startRealtime();
    await until(() => flags.length === 1);
    expect(flags).toEqual([false]);
    rt.stopRealtime();
  });

  it("unsubscribing a listener stops delivery", async () => {
    store.kc_token = `alice:${inSeconds(60)}`;
    const got: unknown[] = [];
    const off = rt.onRealtime("notification:new", (p) => got.push(p));
    rt.startRealtime();
    await until(() => rt.isRealtimeConnected());
    off();
    emitToUser("alice", "notification:new", { id: "x" });
    await wait(200);
    expect(got).toEqual([]);
    rt.stopRealtime();
  });
});

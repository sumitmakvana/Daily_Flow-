// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadOnlyFetch } from "@/lib/read-only-fetch";

const setMode = (v: string | undefined) => {
  if (v === undefined) delete process.env.OPERON_READ_ONLY;
  else process.env.OPERON_READ_ONLY = v;
};
afterEach(() => {
  setMode(undefined);
  vi.restoreAllMocks();
});

describe("createReadOnlyFetch (browser + server HTTP guard)", () => {
  const mk = (allowHosts?: string[]) => {
    const base = vi.fn(async () => new Response("real", { status: 200 }));
    const onBlock = vi.fn();
    return { base, onBlock, f: createReadOnlyFetch(base as unknown as typeof fetch, { allowHosts, onBlock }) };
  };

  it.each(["GET", "HEAD", "OPTIONS", "get"])("lets %s through untouched", async (method) => {
    const { f, base } = mk();
    const r = await f("http://postgrest.test/tasks?select=*", { method });
    expect(await r.text()).toBe("real");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("a request with no method is a GET", async () => {
    const { f, base } = mk();
    await f("http://postgrest.test/tasks");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "post"])("refuses %s with a 403 and never calls the network", async (method) => {
    const { f, base, onBlock } = mk();
    const r = await f("http://postgrest.test/tasks", { method, body: "{}" });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "READ_ONLY_MODE" });
    expect(base).not.toHaveBeenCalled();
    expect(onBlock).toHaveBeenCalledTimes(1);
  });

  it("refuses an RPC call (POST) to PostgREST, e.g. ensure_user_profile", async () => {
    const { f, base } = mk();
    const r = await f("http://localhost:7051/rpc/ensure_user_profile", { method: "POST", body: "{}" });
    expect(r.status).toBe(403);
    expect(base).not.toHaveBeenCalled();
  });

  it("checks Request objects and URL objects too, not only strings", async () => {
    const { f, base } = mk();
    expect((await f(new Request("http://x.test/a", { method: "POST", body: "1" }))).status).toBe(403);
    expect((await f(new URL("http://x.test/a"), { method: "DELETE" })).status).toBe(403);
    expect(base).not.toHaveBeenCalled();
  });

  it("an allow-listed host (the app's own loopback origin) may receive writes; others may not", async () => {
    const { f, base } = mk(["localhost:7050"]);
    expect((await f("http://localhost:7050/api/x", { method: "POST" })).status).toBe(200);
    expect((await f("http://localhost:7051/rpc/x", { method: "POST" })).status).toBe(403);
    expect((await f("https://graph.microsoft.com/v1.0/sendMail", { method: "POST" })).status).toBe(403);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("an allow-list entry is not fooled by a look-alike host or path", async () => {
    const { f } = mk(["localhost:7050"]);
    expect((await f("http://localhost:7050.evil.test/x", { method: "POST" })).status).toBe(403);
    expect((await f("http://evil.test/localhost:7050", { method: "POST" })).status).toBe(403);
  });
});

describe("isReadOnlyMode / installReadOnlyGuards", () => {
  it.each([["1", true], ["true", true], ["TRUE", true], [" 1 ", true], ["0", false], ["false", false], ["", false], ["yes", false], [undefined, false]])(
    "OPERON_READ_ONLY=%j → %s",
    async (v, expected) => {
      setMode(v as string | undefined);
      const { isReadOnlyMode } = await import("@/lib/read-only-mode.server");
      expect(isReadOnlyMode()).toBe(expected);
    },
  );

  it("installReadOnlyGuards blocks outbound writes globally, allows the app's own port, and is idempotent", async () => {
    const realFetch = globalThis.fetch;
    const g = globalThis as unknown as { __operonReadOnlyInstalled?: boolean };
    const base = vi.fn(async () => new Response("ok"));
    globalThis.fetch = base as unknown as typeof fetch;
    g.__operonReadOnlyInstalled = false;
    process.env.PORT = "7050";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { installReadOnlyGuards } = await import("@/lib/read-only-mode.server");
      installReadOnlyGuards();
      const patched = globalThis.fetch;
      installReadOnlyGuards(); // second call must not wrap again
      expect(globalThis.fetch).toBe(patched);
      expect((await fetch("http://localhost:7051/tasks", { method: "PATCH" })).status).toBe(403);
      expect((await fetch("http://localhost:7050/x", { method: "POST" })).status).toBe(200);
      expect((await fetch("http://localhost:7051/tasks")).status).toBe(200);
    } finally {
      globalThis.fetch = realFetch;
      g.__operonReadOnlyInstalled = false;
      delete process.env.PORT;
    }
  });
});

describe("server startup gating (src/server.ts)", () => {
  const calls = vi.hoisted(() => ({ cron: 0, listener: 0, guards: 0 }));
  vi.mock("@/lib/error-capture", () => ({ consumeLastCapturedError: () => null }));
  vi.mock("../../src/lib/error-capture", () => ({ consumeLastCapturedError: () => null }));
  vi.mock("../../src/lib/error-page", () => ({ renderErrorPage: () => "" }));
  vi.mock("../../src/lib/cron-ticker.server", () => ({ startBackgroundCronTicker: () => void (calls.cron += 1) }));
  vi.mock("../../src/lib/notification-listener.server", () => ({ startNotificationListener: () => void (calls.listener += 1) }));
  vi.mock("../../src/lib/realtime.server", () => ({ attachRealtime: vi.fn() }));

  beforeEach(() => {
    vi.resetModules();
    calls.cron = 0;
    calls.listener = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    (globalThis as unknown as { __operonReadOnlyInstalled?: boolean }).__operonReadOnlyInstalled = false;
  });
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    (globalThis as unknown as { __operonReadOnlyInstalled?: boolean }).__operonReadOnlyInstalled = false;
  });

  it("READ-ONLY: cron ticker is NOT started; the (read-only) listener is", async () => {
    setMode("1");
    await import("../../src/server");
    expect(calls.cron).toBe(0);
    expect(calls.listener).toBe(1);
  });

  it("normal mode: cron ticker AND listener start exactly as before", async () => {
    setMode(undefined);
    await import("../../src/server");
    expect(calls.cron).toBe(1);
    expect(calls.listener).toBe(1);
  });
});


// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// Runs the real public/sw.js in a sandbox and drives its fetch handler.
// Regression: the worker used to cache /socket.io and /_serverFn responses and then refetch
// every cached URL in the background, so each data call and each asset hit the network twice.

const source = fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
const ORIGIN = "https://app.test";

type Handler = (e: unknown) => void;
let handlers: Record<string, Handler>;
let netCalls: string[];
let store: Map<string, { body: string; status: number }>;
let online: boolean;
let existingCaches: string[] = [];
let deleted: string[] = [];

class FakeResponse {
  status: number;
  type = "basic";
  constructor(public body: string, init: { status?: number } = {}) {
    this.status = init.status ?? 200;
  }
  clone() {
    const r = new FakeResponse(this.body, { status: this.status });
    return r;
  }
  static error() {
    const r = new FakeResponse("", { status: 0 });
    r.type = "error";
    return r;
  }
}

function loadWorker() {
  handlers = {};
  netCalls = [];
  store = new Map();
  const cache = {
    addAll: async () => {},
    put: async (req: { url: string }, res: FakeResponse) => void store.set(req.url, { body: res.body, status: res.status }),
  };
  const sandbox: Record<string, unknown> = {
    URL,
    Response: FakeResponse,
    console,
    caches: {
      open: async () => cache,
      keys: async () => existingCaches,
      delete: async (name: string) => (deleted.push(name), true),
      match: async (req: { url: string } | string) => {
        const hit = store.get(typeof req === "string" ? ORIGIN + req : req.url);
        return hit ? new FakeResponse(hit.body, { status: hit.status }) : undefined;
      },
    },
    fetch: async (req: { url: string }) => {
      netCalls.push(new URL(req.url).pathname);
      if (!online) throw new TypeError("offline");
      return new FakeResponse("net#" + netCalls.length); // a different body on every network call
    },
    self: {
      location: { origin: ORIGIN },
      addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
      skipWaiting: () => {},
      clients: { claim: () => {}, matchAll: async () => [], openWindow: async () => {} },
    },
  };
  vm.runInNewContext(source, sandbox);
}

/** Dispatch a fetch event; returns the response the worker produced, or "passthrough". */
async function request(pathname: string, init: { method?: string; mode?: string; origin?: string } = {}) {
  let responded: Promise<FakeResponse> | null = null;
  const event = {
    request: {
      url: (init.origin ?? ORIGIN) + pathname,
      method: init.method ?? "GET",
      mode: init.mode ?? "cors",
      headers: { get: () => "*/*" },
    },
    respondWith: (p: Promise<FakeResponse>) => (responded = p),
    waitUntil: () => {},
  };
  handlers.fetch(event);
  if (!responded) return "passthrough" as const;
  const res = await responded;
  await new Promise((r) => setTimeout(r, 0)); // let fire-and-forget cache writes settle
  return res;
}

beforeEach(() => {
  existingCaches = [];
  deleted = [];
  online = true;
  loadWorker();
});

describe("service worker request handling", () => {
  it("never touches Socket.IO traffic", async () => {
    expect(await request("/socket.io/?EIO=4&transport=polling&t=abc")).toBe("passthrough");
    expect(store.size).toBe(0);
    expect(netCalls).toEqual([]);
  });

  it("still ignores non-GET, cross-origin, /api, /rest and auth", async () => {
    expect(await request("/x", { method: "POST" })).toBe("passthrough");
    expect(await request("/x", { origin: "https://other.test" })).toBe("passthrough");
    expect(await request("/api/foo")).toBe("passthrough");
    expect(await request("/rest/v1/tasks")).toBe("passthrough");
    expect(await request("/realms/x/auth/y")).toBe("passthrough");
  });

  it("server-function GETs go to the network exactly once per call (no stale-then-refetch)", async () => {
    const url = "/_serverFn/abc?payload=1";
    const first = (await request(url)) as FakeResponse;
    const second = (await request(url)) as FakeResponse;
    expect(first.body).toBe("net#1");
    expect(second.body).toBe("net#2"); // fresh from the network, not a stale cached copy
    expect(netCalls).toEqual(["/_serverFn/abc", "/_serverFn/abc"]); // one fetch per call
  });

  it("server-function GETs fall back to the last good response when offline", async () => {
    const url = "/_serverFn/abc?payload=1";
    await request(url);
    online = false;
    const res = (await request(url)) as FakeResponse;
    expect(res.status).toBe(200);
    expect(res.body).toBe("net#1");
  });

  it("hashed /assets/ files are downloaded once, then served from cache with no network call (works offline)", async () => {
    const url = "/assets/index-AbC123.js";
    await request(url);
    expect(netCalls).toEqual(["/assets/index-AbC123.js"]);
    online = false;
    for (let i = 0; i < 5; i++) {
      const res = (await request(url)) as FakeResponse;
      expect(res.status).toBe(200);
    }
    expect(netCalls).toHaveLength(1); // no background re-download on later loads
  });

  it("page navigations stay network-first with a cached fallback", async () => {
    online = false;
    store.set(ORIGIN + "/", { body: "shell", status: 200 });
    const res = (await request("/tasks", { mode: "navigate" })) as FakeResponse;
    expect(res.body).toBe("shell");
  });

  it("on activate, deletes the old cache (with its stale socket.io/server-function entries) and keeps the new one", async () => {
    existingCaches = ["execution-os-cache-v2", "execution-os-cache-v3"];
    let waited: Promise<unknown> | null = null;
    handlers.activate({ waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
    expect(deleted).toEqual(["execution-os-cache-v2"]);
  });

  it("uses a new cache name so the old polluted cache is dropped on activate", () => {
    expect(source).toMatch(/CACHE_NAME = 'execution-os-cache-v3'/);
  });
});

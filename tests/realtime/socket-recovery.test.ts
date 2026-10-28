// Client-side recovery logic of src/integrations/realtime/socket.ts, driven with a fake
// Socket.IO socket and fake timers so every delay and decision is exact and fast.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Fn = (...a: any[]) => void;
type ResyncRes = { bootId: string; seq: number; tables?: string[]; full?: boolean };

class FakeSocket {
  connected = false;
  active = false;
  connectCalls = 0;
  emitted: Array<{ event: string; args: unknown[] }> = [];
  /** How the "server" answers a resync: a response, or "timeout". */
  answer: (req: any) => ResyncRes | "timeout" = () => ({ bootId: "b1", seq: 0, tables: [], full: false });
  private handlers = new Map<string, Set<Fn>>();
  private anyHandlers = new Set<Fn>();

  on(ev: string, fn: Fn) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
    return this;
  }
  off(ev: string, fn: Fn) {
    this.handlers.get(ev)?.delete(fn);
    return this;
  }
  onAny(fn: Fn) {
    this.anyHandlers.add(fn);
    return this;
  }
  removeAllListeners() {
    this.handlers.clear();
    this.anyHandlers.clear();
    return this;
  }
  connect() {
    this.connectCalls += 1;
    this.active = true;
    return this;
  }
  disconnect() {
    const was = this.connected;
    this.connected = false;
    this.active = false;
    if (was) this.fire("disconnect", "io client disconnect");
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.emitted.push({ event, args });
    return this;
  }
  timeout(_ms: number) {
    return {
      emit: (event: string, req: unknown, cb: (err: Error | null, res?: ResyncRes) => void) => {
        this.emitted.push({ event, args: [req] });
        const a = this.answer(req);
        if (a === "timeout") cb(new Error("timeout"));
        else cb(null, a);
      },
    };
  }
  private fire(ev: string, ...args: unknown[]) {
    this.handlers.get(ev)?.forEach((h) => h(...args));
  }
  // ---- test controls (what the network / server would do)
  serverConnect() {
    this.connected = true;
    this.active = true;
    this.fire("connect");
  }
  /** Transport lost; Socket.IO keeps reconnecting by itself (active stays true). */
  networkDrop() {
    this.connected = false;
    this.fire("disconnect", "transport close");
  }
  connectError(final = false) {
    if (final) this.active = false;
    this.fire("connect_error", new Error("boom"));
  }
  serverEvent(event: string, payload: unknown, meta?: unknown) {
    this.handlers.get(event)?.forEach((h) => h(payload, meta));
    this.anyHandlers.forEach((h) => h(event, payload, meta));
  }
  resyncRequests() {
    return this.emitted.filter((e) => e.event === "resync").map((e) => e.args[0] as { bootId: string | null; seq: number });
  }
}

let fake: FakeSocket;
vi.mock("socket.io-client", () => ({ io: () => fake }));
vi.mock("@/integrations/backend/auth", () => ({
  auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
}));

type Rt = typeof import("@/integrations/realtime/socket");
let rt: Rt;
let infos: Array<{ full: boolean; tables: string[]; reason: string }>;
let safety: ReturnType<typeof vi.fn>;
// Pending fake timers = what the socket code scheduled (jsdom's own are flushed in beforeEach).
const timers = () => vi.getTimerCount();

const setVisibility = (v: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  fake = new FakeSocket();
  window.localStorage.setItem("kc_token", "tok");
  // Initial state only: dispatching the event here would trigger unrelated listeners in the jsdom setup.
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  vi.runOnlyPendingTimers(); // jsdom schedules a timer for localStorage writes; clear it so counts are exact
  rt = await import("@/integrations/realtime/socket");
  infos = [];
  safety = vi.fn();
  rt.onRealtimeResync((i) => infos.push(i));
  rt.onRealtimeSafetyRefresh(safety);
  rt.startRealtime();
});
afterEach(() => {
  rt.__resetRealtimeForTests();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("resync after connect", () => {
  it("the first clean connect is only a baseline: it asks, but does NOT tell subscribers to refetch", () => {
    fake.answer = () => ({ bootId: "b1", seq: 5, tables: [], full: true });
    fake.serverConnect();
    expect(fake.resyncRequests()).toEqual([{ bootId: null, seq: 0 }]);
    expect(infos).toEqual([]);
  });

  it("a reconnect reports exactly the tables the server says changed", () => {
    fake.answer = () => ({ bootId: "b1", seq: 5, tables: [], full: true });
    fake.serverConnect(); // baseline
    fake.networkDrop();
    fake.answer = () => ({ bootId: "b1", seq: 9, tables: ["tasks", "notifications"], full: false });
    fake.serverConnect();
    expect(infos).toEqual([{ full: false, tables: ["tasks", "notifications"], reason: "connect" }]);
  });

  it("a reconnect where nothing was missed reports an empty list (no refetch)", () => {
    fake.serverConnect();
    fake.networkDrop();
    fake.serverConnect();
    expect(infos).toEqual([{ full: false, tables: [], reason: "connect" }]);
  });

  it("sends the last position it saw, tracking sequence numbers from live events", () => {
    fake.answer = () => ({ bootId: "b1", seq: 5, tables: [], full: false });
    fake.serverConnect();
    fake.serverEvent("entity:changed", { table: "tasks" }, { seq: 6, boot: "b1" });
    fake.serverEvent("entity:changed", { table: "tasks" }, { seq: 8, boot: "b1" });
    fake.serverEvent("entity:changed", { table: "tasks" }, { seq: 7, boot: "b1" }); // out of order: max wins
    fake.serverEvent("entity:changed", { table: "tasks" }, { seq: 99, boot: "OTHER" }); // a different boot is ignored
    fake.serverEvent("notification:new", { id: "n" }); // old-style event without meta: ignored
    fake.networkDrop();
    fake.serverConnect();
    expect(fake.resyncRequests().at(-1)).toEqual({ bootId: "b1", seq: 8 });
  });

  it("a restarted server (different boot id) forces a full refetch", () => {
    fake.answer = () => ({ bootId: "b1", seq: 50, tables: [], full: false });
    fake.serverConnect();
    fake.networkDrop();
    fake.answer = () => ({ bootId: "b2", seq: 3, tables: [], full: false });
    fake.serverConnect();
    expect(infos).toEqual([{ full: true, tables: [], reason: "connect" }]);
    // ...and the new baseline is the new server's position.
    fake.networkDrop();
    fake.answer = () => ({ bootId: "b2", seq: 4, tables: ["tasks"], full: false });
    fake.serverConnect();
    expect(fake.resyncRequests().at(-1)).toEqual({ bootId: "b2", seq: 3 });
    expect(infos.at(-1)).toEqual({ full: false, tables: ["tasks"], reason: "connect" });
  });

  it("no answer (old server / timeout) on a reconnect = full refetch, never silence", () => {
    fake.serverConnect();
    fake.networkDrop();
    fake.answer = () => "timeout";
    fake.serverConnect();
    expect(infos).toEqual([{ full: true, tables: [], reason: "connect" }]);
  });

  it("no answer on the clean first connect does not cause a refetch burst at page load", () => {
    fake.answer = () => "timeout";
    fake.serverConnect();
    expect(infos).toEqual([]);
  });

  it("if the socket could not connect at first, the first successful connect does a full resync", () => {
    fake.connectError(); // page loaded while the socket was unreachable
    fake.answer = () => ({ bootId: "b1", seq: 5, tables: [], full: true });
    fake.serverConnect();
    expect(infos).toEqual([{ full: true, tables: [], reason: "connect" }]);
  });
});

describe("shared safety refresh while disconnected (exponential backoff, never polls while connected)", () => {
  const at = async (ms: number) => vi.advanceTimersByTimeAsync(ms);

  it("fires at 60s, then +2m, +4m, then every 5m (capped), via ONE shared timer", async () => {
    fake.serverConnect();
    fake.networkDrop();
    expect(timers()).toBe(1);
    await at(59_999);
    expect(safety).toHaveBeenCalledTimes(0);
    await at(1); // t = 60s
    expect(safety).toHaveBeenCalledTimes(1);
    await at(119_999);
    expect(safety).toHaveBeenCalledTimes(1);
    await at(1); // t = 3m
    expect(safety).toHaveBeenCalledTimes(2);
    await at(240_000); // t = 7m
    expect(safety).toHaveBeenCalledTimes(3);
    await at(300_000); // t = 12m
    expect(safety).toHaveBeenCalledTimes(4);
    await at(300_000); // t = 17m: still 5 minutes (capped)
    expect(safety).toHaveBeenCalledTimes(5);
    expect(timers()).toBe(1); // always exactly one pending timer
  });

  it("is a single shared timer however many subscribers there are", () => {
    for (let i = 0; i < 20; i++) rt.onRealtimeSafetyRefresh(vi.fn());
    fake.serverConnect();
    fake.networkDrop();
    expect(timers()).toBe(1);
  });

  it("stops IMMEDIATELY when the socket reconnects, and never polls while connected", async () => {
    fake.serverConnect();
    fake.networkDrop();
    await at(60_000);
    expect(safety).toHaveBeenCalledTimes(1);
    fake.serverConnect();
    expect(timers()).toBe(0);
    await at(60 * 60_000); // an hour connected
    expect(safety).toHaveBeenCalledTimes(1);
    expect(fake.emitted.filter((e) => e.event === "resync")).toHaveLength(2); // the initial connect + the one reconnect: no polling in between
  });

  it("restarts from the short 60s step after a new disconnect (backoff resets on a good connection)", async () => {
    fake.serverConnect();
    fake.networkDrop();
    await at(60_000 + 120_000 + 240_000);
    expect(safety).toHaveBeenCalledTimes(3);
    fake.serverConnect();
    fake.networkDrop();
    await at(60_000);
    expect(safety).toHaveBeenCalledTimes(4);
  });

  it("also covers the socket never connecting at all (starts at the first failed attempt)", async () => {
    fake.connectError();
    await at(60_000);
    expect(safety).toHaveBeenCalledTimes(1);
  });

  it("skips the refresh while the tab is hidden but keeps the schedule", async () => {
    fake.serverConnect();
    fake.networkDrop();
    setVisibility("hidden");
    await at(60_000);
    expect(safety).toHaveBeenCalledTimes(0);
    setVisibility("visible");
    await at(120_000);
    expect(safety).toHaveBeenCalledTimes(1);
  });

  it("a throwing handler does not break the chain", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rt.onRealtimeSafetyRefresh(() => {
      throw new Error("handler bug");
    });
    fake.serverConnect();
    fake.networkDrop();
    await at(60_000);
    await at(120_000);
    expect(safety).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("an intentional stop (sign-out) cancels it", async () => {
    fake.serverConnect();
    fake.networkDrop();
    rt.stopRealtime();
    expect(timers()).toBe(0);
    await at(10 * 60_000);
    expect(safety).not.toHaveBeenCalled();
  });

  it("an intentional disconnect by the client does not arm it", () => {
    fake.serverConnect();
    fake.disconnect(); // 'io client disconnect'
    expect(timers()).toBe(0);
  });
});

describe("reconnecting promptly", () => {
  it("the browser coming back online reconnects immediately instead of waiting for the backoff", () => {
    fake.connectError(true); // failed, Socket.IO will not retry on its own
    fake.connectCalls = 0;
    window.dispatchEvent(new Event("online"));
    expect(fake.connectCalls).toBe(1);
  });

  it("'online' while already connected does nothing", () => {
    fake.serverConnect();
    fake.connectCalls = 0;
    window.dispatchEvent(new Event("online"));
    expect(fake.connectCalls).toBe(0);
  });

  it("a tab that becomes visible while disconnected reconnects at once", () => {
    fake.connectError(true);
    fake.connectCalls = 0;
    setVisibility("hidden");
    setVisibility("visible");
    expect(fake.connectCalls).toBe(1);
  });

  it("a tab returning after 5s+ while connected asks for a targeted resync", () => {
    fake.serverConnect();
    fake.resyncRequests(); // (baseline already sent)
    setVisibility("hidden");
    vi.advanceTimersByTime(6000);
    fake.answer = () => ({ bootId: "b1", seq: 3, tables: ["tasks"], full: false });
    setVisibility("visible");
    expect(infos).toEqual([{ full: false, tables: ["tasks"], reason: "visibility" }]);
  });

  it("a quick tab flip (under 5s) asks for nothing", () => {
    fake.serverConnect();
    const before = fake.resyncRequests().length;
    setVisibility("hidden");
    vi.advanceTimersByTime(2000);
    setVisibility("visible");
    expect(fake.resyncRequests().length).toBe(before);
    expect(infos).toEqual([]);
  });

  it("requestRealtimeResync while disconnected reconnects rather than emitting", () => {
    fake.connectError(true);
    fake.connectCalls = 0;
    rt.requestRealtimeResync("manual");
    expect(fake.connectCalls).toBe(1);
    expect(fake.resyncRequests()).toHaveLength(0);
  });

  it("stopRealtime removes the online/visibility listeners", () => {
    fake.connectError(true);
    rt.stopRealtime();
    fake.connectCalls = 0;
    window.dispatchEvent(new Event("online"));
    setVisibility("hidden");
    setVisibility("visible");
    expect(fake.connectCalls).toBe(0);
  });
});

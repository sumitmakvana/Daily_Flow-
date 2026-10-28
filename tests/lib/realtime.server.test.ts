// @vitest-environment node
import { createServer, get as httpGet, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it, vi, afterEach } from "vitest";

// Tokens are "<sub>:<expSeconds>". Anything else is invalid.
vi.mock("@/integrations/backend/jwt.server", () => ({
  verifyBackendJwt: async (token: string) => {
    const [sub, exp] = token.split(":");
    if (!sub || !exp || sub === "bad") throw new Error("invalid");
    return { sub, exp: Number(exp) };
  },
}));
const db = vi.hoisted(() => ({ roles: {} as Record<string, string[]>, fail: false }));
vi.mock("@/integrations/postgres/client.server", () => ({
  getPool: () => ({
    query: async (_sql: string, [userId]: string[]) => {
      if (db.fail) throw new Error("db down");
      const roles = userId in db.roles ? db.roles[userId] : userId === "mgr" ? ["manager"] : [];
      return { rows: roles.map((role) => ({ role })) };
    },
  }),
}));

import { ALL_USERS_ROOM } from "@/lib/entity-events.server";
import {
  EVENT_LOG_MAX,
  __resetEventLogForTests,
  attachRealtime,
  emitToRole,
  emitToRooms,
  emitToUser,
  setPokeHandler,
} from "@/lib/realtime.server";

const inSeconds = (n: number) => Math.floor(Date.now() / 1000) + n;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let http: HttpServer;
let url: string;
const open: Socket[] = [];

function client(token: string | null): Socket {
  const s = connect(url, {
    path: "/socket.io",
    auth: token === null ? {} : { token },
    transports: ["websocket"],
    reconnection: false,
  });
  open.push(s);
  return s;
}
const once = <T = unknown>(s: Socket, ev: string) =>
  new Promise<T>((res) => s.once(ev, res as (v: T) => void));
const connected = (s: Socket) => once(s, "connect");
const silence = (s: Socket, ms = 250) => new Promise<boolean>((res) => {
  let got = false;
  s.once("notification:new", () => (got = true));
  setTimeout(() => res(!got), ms);
});

beforeAll(async () => {
  http = createServer((_req, res) => res.end("app"));
  attachRealtime(http);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(async () => {
  open.forEach((s) => s.close());
  await new Promise((r) => http.close(r));
});

describe("realtime auth", () => {
  it("rejects a missing token", async () => {
    const e = await once<Error>(client(null), "connect_error");
    expect(e.message).toBe("unauthorized");
  });
  it("rejects an invalid token", async () => {
    const e = await once<Error>(client(`bad:${inSeconds(60)}`), "connect_error");
    expect(e.message).toBe("unauthorized");
  });
  it("accepts a valid token", async () => {
    const s = client(`alice:${inSeconds(60)}`);
    await connected(s);
    expect(s.connected).toBe(true);
  });
  it("does not break normal HTTP on the same server", async () => {
    // tests/setup.ts replaces global fetch with a mock, so use node:http.
    const body = await new Promise<string>((res, rej) =>
      httpGet(`${url}/anything`, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(d));
      }).on("error", rej),
    );
    expect(body).toBe("app");
  });
});

describe("realtime delivery", () => {
  it("delivers only to the owning user, on all of their sockets", async () => {
    const a1 = client(`alice:${inSeconds(60)}`);
    const a2 = client(`alice:${inSeconds(60)}`);
    const b = client(`bob:${inSeconds(60)}`);
    await Promise.all([connected(a1), connected(a2), connected(b)]);
    const bQuiet = silence(b);
    const p1 = once(a1, "notification:new");
    const p2 = once(a2, "notification:new");
    emitToUser("alice", "notification:new", { id: "n1" });
    expect(await p1).toEqual({ id: "n1" });
    expect(await p2).toEqual({ id: "n1" });
    expect(await bQuiet).toBe(true);
  });
  it("role rooms reach managers only", async () => {
    const m = client(`mgr:${inSeconds(60)}`);
    const u = client(`alice:${inSeconds(60)}`);
    await Promise.all([connected(m), connected(u)]);
    await new Promise((r) => setTimeout(r, 100)); // role lookup is async
    const uQuiet = silence(u);
    const p = once(m, "notification:new");
    emitToRole("manager", "notification:new", { id: "r1" });
    expect(await p).toEqual({ id: "r1" });
    expect(await uQuiet).toBe(true);
  });
});

describe("role rooms", () => {
  beforeAll(() => {
    db.roles = { mgr2: ["manager"], boss2: ["admin"], flip: ["manager"] };
  });
  it("a manager is already in the manager room the instant they are connected (no startup race)", async () => {
    const m = client(`mgr2:${inSeconds(60)}`);
    const got = once(m, "role:ping");
    await connected(m);
    emitToRole("manager", "role:ping", { ok: 1 }); // immediately, no delay
    expect(await got).toEqual({ ok: 1 });
  });
  it("an admin receives manager-room events (admin implies manager)", async () => {
    const a = client(`boss2:${inSeconds(60)}`);
    const got = once(a, "role:ping");
    await connected(a);
    emitToRole("manager", "role:ping", { ok: 2 });
    expect(await got).toEqual({ ok: 2 });
  });
  it("refuses the connection if roles cannot be read (fails closed, never silently without rooms)", async () => {
    db.fail = true;
    try {
      const e = await once<Error>(client(`mgr2:${inSeconds(60)}`), "connect_error");
      expect(e.message).toBe("unavailable");
    } finally {
      db.fail = false;
    }
  });
  it("a demotion takes effect on the next token refresh, without reconnecting", async () => {
    db.roles.flip = ["manager"];
    const s = client(`flip:${inSeconds(60)}`);
    await connected(s);
    let n = 0;
    s.on("role:ping", () => n++);
    emitToRole("manager", "role:ping", {});
    await wait(150);
    expect(n).toBe(1);
    db.roles.flip = []; // demoted
    expect(await s.emitWithAck("auth:refresh", `flip:${inSeconds(60)}`)).toEqual({ ok: true });
    emitToRole("manager", "role:ping", {});
    await wait(150);
    expect(n).toBe(1); // no longer receives manager events
    expect(s.connected).toBe(true);
    db.roles.flip = ["manager"]; // promoted again
    await s.emitWithAck("auth:refresh", `flip:${inSeconds(60)}`);
    emitToRole("manager", "role:ping", {});
    await wait(150);
    expect(n).toBe(2);
  });
  it("a role lookup failure during refresh keeps the current rooms and the connection", async () => {
    db.roles.flip = ["manager"];
    const s = client(`flip:${inSeconds(60)}`);
    await connected(s);
    let n = 0;
    s.on("role:ping", () => n++);
    db.fail = true;
    try {
      expect(await s.emitWithAck("auth:refresh", `flip:${inSeconds(60)}`)).toEqual({ ok: true });
    } finally {
      db.fail = false;
    }
    emitToRole("manager", "role:ping", {});
    await wait(150);
    expect(n).toBe(1);
  });
});

describe("all-users room (task events)", () => {
  const ping = (s: Socket) => {
    let n = 0;
    s.on("all:ping", () => n++);
    return () => n;
  };
  it("every authenticated socket is in it — members, managers and admins alike", async () => {
    db.roles = { mgr2: ["manager"], boss2: ["admin"], flip: ["manager"] };
    const sockets = ["plain1", "plain2", "mgr2", "boss2"].map((u) => client(`${u}:${inSeconds(60)}`));
    const counts = sockets.map(ping);
    await Promise.all(sockets.map(connected));
    emitToRooms([ALL_USERS_ROOM], "all:ping", {});
    await wait(150);
    expect(counts.map((c) => c())).toEqual([1, 1, 1, 1]);
  });
  it("is joined at connect time, with no startup race", async () => {
    const s = client(`plain3:${inSeconds(60)}`);
    const got = once(s, "all:ping");
    await connected(s);
    emitToRooms([ALL_USERS_ROOM], "all:ping", { ok: 1 }); // immediately
    expect(await got).toEqual({ ok: 1 });
  });
  it("a rejected (unauthenticated) socket never receives it", async () => {
    const bad = client(null);
    const n = ping(bad);
    await once(bad, "connect_error");
    emitToRooms([ALL_USERS_ROOM], "all:ping", {});
    await wait(150);
    expect(n()).toBe(0);
  });
  it("survives token refresh and a role change (only role rooms are re-synced)", async () => {
    db.roles.flip = ["manager"];
    const s = client(`flip:${inSeconds(60)}`);
    await connected(s);
    const n = ping(s);
    db.roles.flip = []; // demoted
    await s.emitWithAck("auth:refresh", `flip:${inSeconds(60)}`);
    emitToRooms([ALL_USERS_ROOM], "all:ping", {});
    await wait(150);
    expect(n()).toBe(1);
  });
  it("a socket whose token expired is dropped and stops receiving", async () => {
    const s = client(`shortlived:${inSeconds(1)}`);
    const n = ping(s);
    await connected(s);
    await once(s, "disconnect");
    emitToRooms([ALL_USERS_ROOM], "all:ping", {});
    await wait(150);
    expect(n()).toBe(0);
  });
});

describe("entity:poke (client says 'I just wrote something')", () => {
  afterEach(() => setPokeHandler(null));

  it("an authenticated socket's poke runs the server's change check — and carries no data", async () => {
    const handler = vi.fn();
    setPokeHandler(handler);
    const s = client(`poker1:${inSeconds(60)}`);
    await connected(s);
    s.emit("entity:poke", { table: "tasks", assigned_to: "someone", evil: "<script>" }); // payload is ignored
    await wait(100);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(); // called with NO arguments: nothing the client sent is used
  });

  it("is rate-limited per socket: a spammer gets at most 10 per 10s, and the connection survives", async () => {
    const handler = vi.fn();
    setPokeHandler(handler);
    const s = client(`poker2:${inSeconds(60)}`);
    await connected(s);
    for (let i = 0; i < 100; i++) s.emit("entity:poke");
    await wait(300);
    expect(handler.mock.calls.length).toBe(10);
    expect(s.connected).toBe(true);
  });

  it("the limit is per socket: another user's pokes still work while one is throttled", async () => {
    const handler = vi.fn();
    setPokeHandler(handler);
    const spam = client(`poker3:${inSeconds(60)}`);
    const other = client(`poker4:${inSeconds(60)}`);
    await Promise.all([connected(spam), connected(other)]);
    for (let i = 0; i < 50; i++) spam.emit("entity:poke");
    await wait(200);
    const before = handler.mock.calls.length;
    other.emit("entity:poke");
    await wait(100);
    expect(handler.mock.calls.length).toBe(before + 1);
  });

  it("a rejected (unauthenticated) socket can never poke", async () => {
    const handler = vi.fn();
    setPokeHandler(handler);
    const bad = client(null);
    await once(bad, "connect_error");
    bad.emit("entity:poke");
    await wait(150);
    expect(handler).not.toHaveBeenCalled();
  });

  it("a throwing handler is contained: logged, socket stays connected, later pokes still work", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn().mockImplementationOnce(() => {
      throw new Error("boom");
    });
    setPokeHandler(handler);
    const s = client(`poker5:${inSeconds(60)}`);
    await connected(s);
    s.emit("entity:poke");
    await wait(100);
    s.emit("entity:poke");
    await wait(100);
    expect(s.connected).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("with no handler installed (watcher disabled) a poke is a harmless no-op", async () => {
    setPokeHandler(null);
    const s = client(`poker6:${inSeconds(60)}`);
    await connected(s);
    s.emit("entity:poke");
    await wait(100);
    expect(s.connected).toBe(true);
  });
});

describe("token refresh and expiry", () => {
  it("drops a socket whose token expires without refresh", async () => {
    const s = client(`carol:${inSeconds(1)}`);
    await connected(s);
    const expired = once(s, "auth:expired");
    const gone = once(s, "disconnect");
    await expired;
    await gone;
    expect(s.connected).toBe(false);
  });
  it("keeps a socket alive when the token is refreshed", async () => {
    const s = client(`dave:${inSeconds(1)}`);
    await connected(s);
    const ack = await s.emitWithAck("auth:refresh", `dave:${inSeconds(60)}`);
    expect(ack).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 1500));
    expect(s.connected).toBe(true);
  });
  it("refuses a refresh for a different user and disconnects", async () => {
    const s = client(`erin:${inSeconds(60)}`);
    await connected(s);
    const gone = once(s, "disconnect");
    const ack = await s.emitWithAck("auth:refresh", `mallory:${inSeconds(60)}`);
    expect(ack).toEqual({ ok: false });
    await gone;
  });
});

describe("resync (missed-update recovery)", () => {
  type Resync = { bootId: string; seq: number; tables: string[]; full: boolean };
  const ask = (s: Socket, req: unknown) => new Promise<Resync>((res) => s.emit("resync", req, res));
  const ent = (table: string, id = "1") => ({ schema: "public", table, eventType: "UPDATE", new: { id }, old: {} });

  it("stamps every event with { seq, boot } as a second argument; the payload is unchanged", async () => {
    const a = client(`alice:${inSeconds(60)}`);
    await connected(a);
    const got = new Promise<unknown[]>((res) => a.once("notification:new", (...args) => res(args)));
    emitToUser("alice", "notification:new", { id: "n1" });
    const [payload, meta] = (await got) as [unknown, { seq: number; boot: string }];
    expect(payload).toEqual({ id: "n1" });
    expect(typeof meta.seq).toBe("number");
    expect(typeof meta.boot).toBe("string");
    a.close();
  });

  it("an unknown baseline gets a full resync plus the current position to start from", async () => {
    const a = client(`alice:${inSeconds(60)}`);
    await connected(a);
    const r = await ask(a, { bootId: null, seq: null });
    expect(r.full).toBe(true);
    expect(typeof r.bootId).toBe("string");
    expect(r.seq).toBeGreaterThanOrEqual(0);
    a.close();
  });

  it("reports only the tables that changed for THIS socket since its last position", async () => {
    const a = client(`alice:${inSeconds(60)}`);
    const m = client(`mgr:${inSeconds(60)}`);
    await Promise.all([connected(a), connected(m)]);
    const base = await ask(a, { bootId: null, seq: null });

    emitToRooms([ALL_USERS_ROOM], "entity:changed", ent("tasks"));
    emitToUser("alice", "notification:new", { id: "n1", user_id: "alice" });
    emitToUser("bob", "notification:new", { id: "n2", user_id: "bob" }); // not alice's
    emitToRooms(["role:manager"], "entity:changed", ent("risk_events")); // managers only

    const forAlice = await ask(a, { bootId: base.bootId, seq: base.seq });
    expect(forAlice.full).toBe(false);
    expect(forAlice.tables.sort()).toEqual(["notifications", "tasks"]); // no risk_events, nothing of bob's

    const forMgr = await ask(m, { bootId: base.bootId, seq: base.seq });
    expect(forMgr.tables).toEqual(expect.arrayContaining(["tasks", "risk_events"]));
    expect(forMgr.tables).not.toContain("notifications"); // alice's and bob's notifications are not the manager's
    a.close();
    m.close();
  });

  it("nothing changed since the given position = empty list, not a full refetch", async () => {
    const a = client(`alice:${inSeconds(60)}`);
    await connected(a);
    emitToRooms([ALL_USERS_ROOM], "entity:changed", ent("tasks"));
    const first = await ask(a, { bootId: null, seq: null });
    const again = await ask(a, { bootId: first.bootId, seq: first.seq });
    expect(again).toMatchObject({ full: false, tables: [] });
    a.close();
  });

  it("a restarted server (new boot id) answers full, so nothing is silently missed", async () => {
    const a = client(`alice:${inSeconds(60)}`);
    await connected(a);
    const before = await ask(a, { bootId: null, seq: null });
    __resetEventLogForTests(); // what a process restart does to the in-memory log
    const after = await ask(a, { bootId: before.bootId, seq: before.seq });
    expect(after.full).toBe(true);
    expect(after.bootId).not.toBe(before.bootId);
    a.close();
  });

  it("a position older than the retained log answers full (it cannot prove what was missed)", async () => {
    const a = client(`alice:${inSeconds(60)}`);
    await connected(a);
    const base = await ask(a, { bootId: null, seq: null });
    for (let i = 0; i < EVENT_LOG_MAX + 25; i++) emitToRooms([ALL_USERS_ROOM], "entity:changed", ent("tasks", String(i)));
    const r = await ask(a, { bootId: base.bootId, seq: base.seq });
    expect(r.full).toBe(true);
    // ...while a recent position is still answered precisely.
    const recent = await ask(a, { bootId: r.bootId, seq: r.seq });
    expect(recent).toMatchObject({ full: false, tables: [] });
    a.close();
  });

  it("a position from the future (or garbage) is treated as unknown: full, never a crash", async () => {
    const a = client(`alice:${inSeconds(60)}`);
    await connected(a);
    const base = await ask(a, { bootId: null, seq: null });
    expect((await ask(a, { bootId: base.bootId, seq: base.seq + 1_000_000 })).full).toBe(true);
    expect((await ask(a, "nonsense")).full).toBe(true);
    expect((await ask(a, { bootId: 5, seq: "x" })).full).toBe(true);
    a.emit("resync", { bootId: base.bootId, seq: base.seq }); // no ack: ignored, socket stays up
    await wait(100);
    expect(a.connected).toBe(true);
    a.close();
  });

  it("a rejected (unauthenticated) socket cannot ask", async () => {
    const e = await once<Error>(client(null), "connect_error");
    expect(e.message).toBe("unauthorized");
  });
});

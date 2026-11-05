// @vitest-environment node
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/backend/jwt.server", () => ({
  verifyBackendJwt: async (token: string) => {
    const [sub, exp] = token.split(":");
    return { sub, exp: Number(exp) };
  },
}));
const db = vi.hoisted(() => ({
  unread: {} as Record<string, number>,
  countQueries: [] as Array<{ sql: string; params: unknown[] }>,
  failCount: false,
  onCount: null as null | (() => void),
}));
vi.mock("@/integrations/postgres/client.server", () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes("user_roles")) return { rows: [] };
      db.countQueries.push({ sql, params });
      db.onCount?.();
      if (db.failCount) throw new Error("db down");
      return { rows: [{ n: db.unread[params[0] as string] ?? 0 }] };
    },
  }),
}));

import { attachRealtime } from "@/lib/realtime.server";
import {
  UNREAD_DEBOUNCE_MS,
  UNREAD_WINDOW_MS,
  __resetUnreadForTests,
  countUnread,
  scheduleUnreadPush,
} from "@/lib/notification-unread.server";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = () => wait(UNREAD_DEBOUNCE_MS + 120);
const exp = () => Math.floor(Date.now() / 1000) + 600;

let http: HttpServer;
let url: string;
const open: Socket[] = [];

async function client(user: string): Promise<{ s: Socket; counts: number[] }> {
  const s = connect(url, { path: "/socket.io", auth: { token: `${user}:${exp()}` }, transports: ["websocket"], reconnection: false });
  open.push(s);
  const counts: number[] = [];
  s.on("notification:unread", (p: { count: number }) => counts.push(p.count));
  await new Promise<void>((r) => s.once("connect", () => r()));
  return { s, counts };
}

beforeAll(async () => {
  http = createServer((_q, r) => r.end("app"));
  attachRealtime(http);
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(async () => {
  open.forEach((s) => s.close());
  await new Promise((r) => http.close(r));
});
beforeEach(() => {
  db.unread = {};
  db.countQueries = [];
  db.failCount = false;
  db.onCount = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  __resetUnreadForTests();
  open.splice(0).forEach((s) => s.close());
  await wait(50); // let the server drop the sockets from their rooms
  vi.restoreAllMocks();
});

describe("countUnread", () => {
  it("counts unread rows of one user inside the 24 h window", async () => {
    db.unread.u1 = 4;
    expect(await countUnread("u1")).toBe(4);
    const { sql, params } = db.countQueries[0];
    expect(sql).toMatch(/read_at IS NULL/);
    expect(sql).toMatch(/user_id = \$1/);
    const age = Date.now() - Date.parse(params[1] as string);
    expect(Math.abs(age - UNREAD_WINDOW_MS)).toBeLessThan(60_000);
  });
});

describe("scheduleUnreadPush", () => {
  it("pushes the count to every socket of the user, and to no one else", async () => {
    const a1 = await client("u1");
    const a2 = await client("u1");
    const other = await client("u2");
    db.unread.u1 = 3;
    scheduleUnreadPush("u1");
    await settle();
    expect(a1.counts).toEqual([3]);
    expect(a2.counts).toEqual([3]);
    expect(other.counts).toEqual([]);
  });

  it("a burst of creates / reads / deletes costs ONE count query and ONE event", async () => {
    const { counts } = await client("u1");
    db.unread.u1 = 7;
    for (let i = 0; i < 25; i++) scheduleUnreadPush("u1");
    await settle();
    expect(db.countQueries).toHaveLength(1);
    expect(counts).toEqual([7]);
  });

  it("a change that lands while a count is running triggers a recount, so the last event is the latest state", async () => {
    const { counts } = await client("u1");
    db.unread.u1 = 1;
    db.onCount = () => {
      db.onCount = null;
      db.unread.u1 = 2; // a row arrives while the first count is in flight...
      scheduleUnreadPush("u1"); // ...and its own trigger fires
    };
    scheduleUnreadPush("u1");
    await wait(UNREAD_DEBOUNCE_MS * 3 + 150);
    expect(counts.at(-1)).toBe(2);
    expect(db.countQueries).toHaveLength(2);
  });

  it("does not query the database when the user has no connected socket", async () => {
    db.unread.nobody = 5;
    scheduleUnreadPush("nobody");
    await settle();
    expect(db.countQueries).toHaveLength(0);
  });

  it("a failing count query is swallowed and does not stop later pushes", async () => {
    const { counts } = await client("u1");
    db.failCount = true;
    scheduleUnreadPush("u1");
    await settle();
    expect(counts).toEqual([]);
    db.failCount = false;
    db.unread.u1 = 9;
    scheduleUnreadPush("u1");
    await settle();
    expect(counts).toEqual([9]);
  });

  it("reconnect: a socket that dropped misses the push, and a push after it reconnects reaches it", async () => {
    const first = await client("u1");
    first.s.disconnect();
    await wait(50);
    db.unread.u1 = 1;
    scheduleUnreadPush("u1"); // nobody connected: skipped
    await settle();
    expect(db.countQueries).toHaveLength(0);
    const second = await client("u1"); // reconnect (the browser re-fetches the count itself at this point)
    db.unread.u1 = 2;
    scheduleUnreadPush("u1");
    await settle();
    expect(second.counts).toEqual([2]);
    expect(first.counts).toEqual([]);
  });

  it("ignores an empty user id", async () => {
    scheduleUnreadPush("");
    await settle();
    expect(db.countQueries).toHaveLength(0);
  });
});

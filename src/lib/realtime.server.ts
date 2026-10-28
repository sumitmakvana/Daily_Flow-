/**
 * Socket.IO realtime layer — server-only.
 *
 * Attached to the existing Node HTTP server (runner.js, PORT 8080 in the
 * container / 7050 on the host) under the default `/socket.io/` path. It does
 * not open a port of its own.
 *
 * Auth: the client passes its Keycloak access token in `handshake.auth.token`.
 * It is verified with the same `verifyBackendJwt` used by server functions.
 * Each socket joins `user:<sub>`, the all-users room (task events; see
 * entity-events.server.ts) and `role:manager` / `role:admin` when the user has
 * those roles. Rooms come from the verified token and the database,
 * never from client-supplied ids.
 *
 * Token refresh: the client emits `auth:refresh` with the new token. A socket
 * whose token expires without a refresh is told `auth:expired` and dropped.
 *
 * Events are signals plus small payloads; REST stays the source of truth.
 *
 * Missed-update recovery: every event is stamped with a sequence number
 * (`{ seq, boot }` as a second emit argument; old clients ignore it) and the
 * recent ones are kept in a small in-memory log. A client that reconnects asks
 * `resync` with the last `{ bootId, seq }` it saw and is told exactly which
 * tables changed for it in between (or `full: true` if the log cannot answer,
 * e.g. the server restarted), so it refetches only what it missed.
 */
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { verifyBackendJwt } from "@/integrations/backend/jwt.server";
import { getPool } from "@/integrations/postgres/client.server";
import { ALL_USERS_ROOM } from "@/lib/entity-events.server";

/** Recent events kept for resync. Plenty for a reconnect; older gaps answer `full: true`. */
export const EVENT_LOG_MAX = 2000;

type LogEntry = { seq: number; table: string; rooms: string[] };
type EventLog = {
  boot: string;
  seq: number;
  /** Highest sequence number that has been dropped from `entries` (0 = none). */
  floor: number;
  entries: LogEntry[];
};

const g = globalThis as unknown as { __operonIo?: Server; __operonEventLog?: EventLog };

function eventLog(): EventLog {
  return (g.__operonEventLog ??= { boot: randomUUID(), seq: 0, floor: 0, entries: [] });
}

/** Which table a pushed event is about (null = not a resync-able event). */
function tableOf(event: string, payload: unknown): string | null {
  if (event === "notification:new") return "notifications";
  const t = (payload as { table?: unknown } | null)?.table;
  if (typeof t === "string") return t;
  if (event === "automation:health") return "automation_health";
  return null;
}

/** Stamp an outgoing event and remember it for resync. */
function stamp(event: string, payload: unknown, rooms: string[]): { seq: number; boot: string } {
  const log = eventLog();
  log.seq += 1;
  const table = tableOf(event, payload);
  if (table) {
    log.entries.push({ seq: log.seq, table, rooms });
    if (log.entries.length > EVENT_LOG_MAX) {
      const dropped = log.entries.shift()!;
      log.floor = dropped.seq;
    }
  }
  return { seq: log.seq, boot: log.boot };
}

export type ResyncResponse = { bootId: string; seq: number; tables: string[]; full: boolean };

/** What did this socket miss since `(bootId, seq)`? Exported for tests. */
export function buildResync(rooms: ReadonlySet<string>, bootId: string | null, seq: number | null): ResyncResponse {
  const log = eventLog();
  // Unknown baseline, a restarted server, or a gap older than the log: the client must refetch everything.
  if (bootId !== log.boot || seq === null || seq > log.seq || seq < log.floor) {
    return { bootId: log.boot, seq: log.seq, tables: [], full: true };
  }
  const tables = new Set<string>();
  for (const e of log.entries) {
    if (e.seq <= seq) continue;
    if (e.rooms.some((r) => rooms.has(r))) tables.add(e.table);
  }
  return { bootId: log.boot, seq: log.seq, tables: [...tables], full: false };
}

type SocketData = {
  userId: string;
  roleRooms?: string[];
  expTimer?: NodeJS.Timeout;
  pokes?: number[];
};

// Called when a signed-in client reports "I just wrote something" (entity:poke).
// It carries no data: it only asks the server to run its own read-only change check.
let pokeHandler: (() => void) | null = null;
export function setPokeHandler(fn: (() => void) | null) {
  pokeHandler = fn;
}
const POKE_LIMIT = 10; // per socket
const POKE_WINDOW_MS = 10_000;

function extractToken(socket: Socket): string | null {
  const t = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  return typeof t === "string" && t.length > 0 ? t : null;
}

function armExpiry(socket: Socket, exp: number | undefined) {
  const data = socket.data as SocketData;
  if (data.expTimer) clearTimeout(data.expTimer);
  if (!exp) return;
  const ms = exp * 1000 - Date.now();
  data.expTimer = setTimeout(
    () => {
      socket.emit("auth:expired");
      socket.disconnect(true);
    },
    Math.max(ms, 0),
  );
  data.expTimer.unref?.();
}

const ROLE_ROOMS = ["role:admin", "role:manager"] as const;

/** Rooms this user's roles entitle them to. Throws if the database can't be read. */
async function loadRoleRooms(userId: string): Promise<string[]> {
  const { rows } = await getPool().query<{ role: string }>(
    "SELECT role FROM public.user_roles WHERE user_id = $1",
    [userId],
  );
  const rooms = new Set<string>();
  for (const r of rows) {
    if (r.role === "admin") {
      rooms.add("role:admin");
      rooms.add("role:manager");
    } else if (r.role === "manager") {
      rooms.add("role:manager");
    }
  }
  return [...rooms];
}

/** Make the socket's role rooms exactly match `wanted` (joins AND leaves). */
function syncRoleRooms(socket: Socket, wanted: string[]) {
  for (const room of ROLE_ROOMS) {
    if (wanted.includes(room)) socket.join(room);
    else socket.leave(room);
  }
}

export function attachRealtime(httpServer: HttpServer): Server {
  if (g.__operonIo) return g.__operonIo;

  const io = new Server(httpServer, {
    path: "/socket.io",
    // Same-origin only: the app and the socket share a host, so no CORS.
    cors: undefined,
    maxHttpBufferSize: 1e5,
    serveClient: false,
  });
  g.__operonIo = io;

  io.use(async (socket, next) => {
    const token = extractToken(socket);
    if (!token) return next(new Error("unauthorized"));
    try {
      const claims = await verifyBackendJwt(token);
      if (!claims.sub) return next(new Error("unauthorized"));
      (socket.data as SocketData).userId = claims.sub;
      (socket.data as { exp?: number }).exp = claims.exp;
    } catch {
      return next(new Error("unauthorized"));
    }
    // Resolve role rooms before the client is told it is connected, so there is
    // no window where a manager is connected but not yet in the manager room.
    // If the database is unreachable, refuse (the client retries) rather than
    // silently connecting without the rooms the user is entitled to.
    try {
      (socket.data as SocketData).roleRooms = await loadRoleRooms((socket.data as SocketData).userId);
      next();
    } catch (err) {
      console.warn("[Realtime] role lookup failed, refusing connection:", (err as Error).message);
      next(new Error("unavailable"));
    }
  });

  io.on("connection", (socket) => {
    const data = socket.data as SocketData & { exp?: number };
    socket.join(`user:${data.userId}`);
    socket.join(ALL_USERS_ROOM); // every authenticated socket (task events)
    syncRoleRooms(socket, data.roleRooms ?? []);
    armExpiry(socket, data.exp);

    // Authenticated sockets only (the middleware already rejected the rest). A
    // client cannot inject data or choose recipients; excess pokes are ignored.
    socket.on("entity:poke", () => {
      const now = Date.now();
      const recent = (data.pokes ?? []).filter((t) => now - t < POKE_WINDOW_MS);
      if (recent.length >= POKE_LIMIT) {
        data.pokes = recent;
        return;
      }
      recent.push(now);
      data.pokes = recent;
      try {
        pokeHandler?.();
      } catch (err) {
        console.warn("[Realtime] poke handler failed:", (err as Error).message);
      }
    });

    // "What did I miss?" Answered from the room memberships this socket actually has,
    // so a client only hears about tables it is entitled to. Carries no data.
    socket.on("resync", (req: unknown, ack?: (res: ResyncResponse) => void) => {
      if (typeof ack !== "function") return;
      const r = (req && typeof req === "object" ? req : {}) as { bootId?: unknown; seq?: unknown };
      ack(
        buildResync(
          socket.rooms,
          typeof r.bootId === "string" ? r.bootId : null,
          typeof r.seq === "number" && Number.isFinite(r.seq) ? r.seq : null,
        ),
      );
    });

    socket.on("auth:refresh", async (token: unknown, ack?: (res: { ok: boolean }) => void) => {
      try {
        if (typeof token !== "string") throw new Error("bad token");
        const claims = await verifyBackendJwt(token);
        // A refresh may only extend the same identity; never switch users.
        if (claims.sub !== data.userId) throw new Error("subject mismatch");
        armExpiry(socket, claims.exp);
        // Roles may have changed since connect: re-sync rooms on every refresh.
        // If the lookup fails, keep the current rooms; the next refresh retries.
        try {
          syncRoleRooms(socket, await loadRoleRooms(data.userId));
        } catch (err) {
          console.warn("[Realtime] role re-sync failed:", (err as Error).message);
        }
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
        socket.emit("auth:expired");
        socket.disconnect(true);
      }
    });

    socket.on("disconnect", () => {
      if (data.expTimer) clearTimeout(data.expTimer);
    });
  });

  console.log("[Realtime] Socket.IO attached on /socket.io");
  return io;
}

/** Emit to every socket of one user. No-op if realtime is not attached. */
export function emitToUser(userId: string, event: string, payload: unknown) {
  const io = g.__operonIo;
  if (!io) return;
  const room = `user:${userId}`;
  io.to(room).emit(event, payload, stamp(event, payload, [room]));
}

/**
 * Emit to several rooms in one call. Socket.IO delivers once per socket even if
 * the socket is in more than one of the rooms (e.g. an assignee who is also a manager).
 */
export function emitToRooms(rooms: string[], event: string, payload: unknown) {
  if (rooms.length === 0) return;
  const io = g.__operonIo;
  if (!io) return;
  io.to(rooms).emit(event, payload, stamp(event, payload, rooms));
}

/** Emit to a role room (`manager` includes admins). */
export function emitToRole(role: "manager" | "admin", event: string, payload: unknown) {
  const io = g.__operonIo;
  if (!io) return;
  const room = `role:${role}`;
  io.to(room).emit(event, payload, stamp(event, payload, [room]));
}

/** Test hook: forget the event log (a "restarted server"). */
export function __resetEventLogForTests() {
  g.__operonEventLog = undefined;
}

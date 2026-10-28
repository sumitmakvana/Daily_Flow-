/**
 * Singleton Socket.IO client (browser only).
 *
 * Connects to the same origin on `/socket.io` and authenticates with the
 * Keycloak access token stored in localStorage as `kc_token`.
 *
 * Lifecycle
 *  - startRealtime(): connect, and follow auth events (SIGNED_IN connects,
 *    SIGNED_OUT disconnects, TOKEN_REFRESHED re-authenticates the live socket).
 *  - stopRealtime(): disconnect and stop following auth events (call on logout).
 *  - The `auth` option is a callback, so every automatic reconnect uses the
 *    latest token rather than the one captured at first connect.
 *  - The server rejects bad/expired tokens with `unauthorized`, which Socket.IO
 *    does not retry on its own, so we retry with backoff.
 *
 * Events are signals. REST stays the source of truth.
 *
 * Recovery (no per-subscriber polling):
 *  - Every server event carries `{ seq, boot }`. On every connect the client
 *    sends `resync` with the last `{ bootId, seq }` and the server answers which
 *    tables changed for this user meanwhile (or `full`, e.g. after a server
 *    restart). Consumers refetch only those tables (`onRealtimeResync`).
 *  - The first connect of a page load is only a baseline (the initial fetch
 *    covers it) unless an earlier attempt had failed, in which case it resyncs.
 *  - The browser `online` event and a tab becoming visible while disconnected
 *    reconnect immediately; a tab returning after 5s+ asks for a resync.
 *  - While disconnected, ONE shared safety refresh runs with exponential
 *    backoff (60s, 2m, 4m, then every 5m) and stops the moment the socket
 *    reconnects (`onRealtimeSafetyRefresh`).
 */
import { io, type Socket } from "socket.io-client";
import { auth } from "@/integrations/backend/auth";

const isBrowser = typeof window !== "undefined";

let socket: Socket | null = null;
let connectCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;
let authSub: { unsubscribe: () => void } | null = null;

/** Safety refresh delays while disconnected: 60s, 2m, 4m, then every 5m (cap). */
export const SAFETY_REFRESH_DELAYS_MS = [60_000, 120_000, 240_000, 300_000];
/** A tab hidden at least this long asks for a resync when it comes back. */
const VISIBILITY_RESYNC_AFTER_MS = 5000;
const RESYNC_TIMEOUT_MS = 5000;

export type ResyncReason = "connect" | "visibility" | "manual";
export type ResyncInfo = { full: boolean; tables: string[]; reason: ResyncReason };
type ResyncResponse = { bootId: string; seq: number; tables?: string[]; full?: boolean };

let lastBootId: string | null = null;
let lastSeq = 0;
let failedBeforeFirstConnect = false;
const resyncHandlers = new Set<(info: ResyncInfo) => void>();
const safetyHandlers = new Set<() => void>();
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let safetyStep = 0;
let lifecycleCleanup: (() => void) | null = null;

function disarmSafetyNet() {
  if (safetyTimer) clearTimeout(safetyTimer);
  safetyTimer = null;
  safetyStep = 0;
}

/** Start the (single, shared) backed-off safety refresh. No-op if already running. */
function armSafetyNet() {
  if (!isBrowser || safetyTimer) return;
  const delay = SAFETY_REFRESH_DELAYS_MS[Math.min(safetyStep, SAFETY_REFRESH_DELAYS_MS.length - 1)];
  safetyTimer = setTimeout(() => {
    safetyTimer = null;
    if (socket?.connected) {
      safetyStep = 0;
      return;
    }
    safetyStep += 1;
    armSafetyNet(); // schedule the next one first, so a throwing handler cannot stop the chain
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    safetyHandlers.forEach((h) => {
      try {
        h();
      } catch (err) {
        console.warn("[realtime] safety refresh handler failed:", (err as Error).message);
      }
    });
  }, delay);
}

function notifyResync(info: ResyncInfo) {
  resyncHandlers.forEach((h) => {
    try {
      h(info);
    } catch (err) {
      console.warn("[realtime] resync handler failed:", (err as Error).message);
    }
  });
}

/** Remember the highest event sequence seen so a later resync only reports what was really missed. */
function trackSeq(meta: unknown) {
  const m = meta as { seq?: unknown; boot?: unknown } | undefined;
  if (!m || typeof m.seq !== "number" || typeof m.boot !== "string") return;
  if (lastBootId === null || m.boot === lastBootId) lastSeq = Math.max(lastSeq, m.seq);
}

/** Ask the server what changed since we last looked, then tell the subscribers. */
function sendResync(reason: ResyncReason) {
  const s = socket;
  if (!s || !s.connected) return;
  // The very first connect of this page load is only a baseline, unless an earlier attempt failed.
  const baselineOnly = reason === "connect" && connectCount === 1 && !failedBeforeFirstConnect;
  s.timeout(RESYNC_TIMEOUT_MS).emit(
    "resync",
    { bootId: lastBootId, seq: lastSeq },
    (err: Error | null, res?: ResyncResponse) => {
      if (err || !res || typeof res.bootId !== "string") {
        // Old server or no answer: be safe and refetch everything (except on a clean first connect).
        if (!baselineOnly) notifyResync({ full: true, tables: [], reason });
        return;
      }
      const bootChanged = lastBootId !== null && res.bootId !== lastBootId;
      const known = lastBootId !== null && !bootChanged;
      lastBootId = res.bootId;
      lastSeq = known ? Math.max(lastSeq, res.seq) : res.seq;
      if (baselineOnly) return;
      notifyResync({ full: !!res.full || bootChanged, tables: res.tables ?? [], reason });
    },
  );
}

/**
 * Ask for a resync now (e.g. a tab came back). When disconnected this reconnects
 * instead; the resync then runs automatically on connect.
 */
export function requestRealtimeResync(reason: ResyncReason = "manual") {
  if (!socket?.connected) {
    reconnectNow();
    return;
  }
  sendResync(reason);
}

/**
 * Called with exactly what to refetch after a reconnect or a long tab absence:
 * `full` (everything) or the list of changed tables. Not called on a clean first connect.
 */
export function onRealtimeResync(handler: (info: ResyncInfo) => void): () => void {
  ensureSocket();
  resyncHandlers.add(handler);
  return () => {
    resyncHandlers.delete(handler);
  };
}

/**
 * Called by the ONE shared safety refresh while the socket stays disconnected
 * (first after 60s, then 2m, 4m, then every 5m). Never fires while connected.
 */
export function onRealtimeSafetyRefresh(handler: () => void): () => void {
  safetyHandlers.add(handler);
  return () => {
    safetyHandlers.delete(handler);
  };
}

function readToken(): string | null {
  try {
    return window.localStorage.getItem("kc_token");
  } catch {
    return null;
  }
}

function clearRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry() {
  if (!socket || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    // Token may have been refreshed meanwhile; the auth callback re-reads it.
    if (socket && !socket.active && readToken()) socket.connect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

function ensureSocket(): Socket | null {
  if (!isBrowser) return null;
  if (socket) return socket;

  const s = io({
    path: "/socket.io",
    autoConnect: false,
    reconnection: true,
    reconnectionDelayMax: 10_000,
    auth: (cb) => cb({ token: readToken() }),
  });

  s.on("connect", () => {
    retryDelay = 2000;
    clearRetry();
    connectCount += 1;
    disarmSafetyNet();
    sendResync("connect");
  });
  // A middleware rejection ("unauthorized", "unavailable") is final for that
  // attempt and Socket.IO won't retry it itself (s.active is false). Transport
  // errors leave s.active true and use Socket.IO's own reconnection.
  s.on("connect_error", () => {
    if (connectCount === 0) failedBeforeFirstConnect = true;
    armSafetyNet();
    if (!s.active) scheduleRetry();
  });
  // Server dropped us (token expired without refresh): Socket.IO won't retry.
  s.on("disconnect", (reason) => {
    if (reason !== "io client disconnect") armSafetyNet(); // we did not choose to leave
    if (reason === "io server disconnect") scheduleRetry();
  });
  s.onAny((_event, ...args) => trackSeq(args[args.length - 1]));

  socket = s;
  return s;
}

/** Reconnect right now (browser back online, tab visible again) instead of waiting for the backoff. */
function reconnectNow() {
  if (!readToken()) return;
  const s = ensureSocket();
  if (!s || s.connected) return;
  clearRetry();
  retryDelay = 2000;
  if (!s.active) s.connect();
}

function attachLifecycleListeners() {
  if (lifecycleCleanup || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  const onOnline = () => reconnectNow();
  let hiddenAt = 0;
  const onVisibility = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (!socket?.connected) {
      reconnectNow();
      return;
    }
    if (away >= VISIBILITY_RESYNC_AFTER_MS) sendResync("visibility");
  };
  window.addEventListener("online", onOnline);
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  lifecycleCleanup = () => {
    window.removeEventListener("online", onOnline);
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

function connectIfPossible() {
  const s = ensureSocket();
  if (!s || s.active || !readToken()) return;
  s.connect();
}

/** Re-authenticate the live socket after Keycloak refreshed the token. */
function sendRefreshedToken() {
  const token = readToken();
  if (!socket || !socket.connected || !token) return;
  socket.timeout(5000).emit("auth:refresh", token, (err: Error | null, res?: { ok: boolean }) => {
    // Timeout or rejection: drop and reconnect with the current token.
    if (err || !res?.ok) {
      socket?.disconnect();
      scheduleRetry();
    }
  });
}

export function startRealtime() {
  if (!isBrowser || authSub) return;
  const { data } = auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") connectIfPossible();
    else if (event === "TOKEN_REFRESHED") sendRefreshedToken();
    else if (event === "SIGNED_OUT") disconnectSocket();
  });
  authSub = data.subscription;
  attachLifecycleListeners();
  connectIfPossible();
}

function disconnectSocket() {
  clearRetry();
  disarmSafetyNet(); // signed out / stopped on purpose: nothing to refresh
  retryDelay = 2000;
  socket?.disconnect();
}

export function stopRealtime() {
  authSub?.unsubscribe();
  authSub = null;
  lifecycleCleanup?.();
  lifecycleCleanup = null;
  disconnectSocket();
}

export function isRealtimeConnected(): boolean {
  return !!socket?.connected;
}

let lastPoke = 0;
let pokeTimer: ReturnType<typeof setTimeout> | null = null;
const POKE_MIN_GAP_MS = 300;

/**
 * Tell the server "I just wrote something" so it can run its read-only change
 * check immediately instead of waiting for its next periodic one. Carries no
 * data; throttled; a no-op while the socket is not connected.
 */
export function pokeRealtime(): void {
  if (!socket?.connected) return;
  const gap = Date.now() - lastPoke;
  if (gap >= POKE_MIN_GAP_MS) {
    lastPoke = Date.now();
    socket.emit("entity:poke");
    return;
  }
  if (pokeTimer) return;
  pokeTimer = setTimeout(() => {
    pokeTimer = null;
    lastPoke = Date.now();
    if (socket?.connected) socket.emit("entity:poke");
  }, POKE_MIN_GAP_MS - gap);
}

/** Subscribe to a server event. Safe to call before the socket connects. */
export function onRealtime<T = unknown>(event: string, handler: (payload: T) => void): () => void {
  const s = ensureSocket();
  if (!s) return () => {};
  s.on(event, handler as (...args: unknown[]) => void);
  return () => {
    s.off(event, handler as (...args: unknown[]) => void);
  };
}

/**
 * Called on every successful connect. `isReconnect` is false only for the
 * very first connect of this page load, so consumers can refetch to catch up
 * on events missed while disconnected.
 */
export function onRealtimeConnect(handler: (isReconnect: boolean) => void): () => void {
  const s = ensureSocket();
  if (!s) return () => {};
  // Registered after ensureSocket's own "connect" handler, so connectCount is
  // already incremented when this runs.
  const onConnect = () => handler(connectCount > 1);
  s.on("connect", onConnect);
  return () => {
    s.off("connect", onConnect);
  };
}

/** Test hook: reset module state. */
export function __resetRealtimeForTests() {
  stopRealtime();
  socket?.removeAllListeners();
  socket = null;
  connectCount = 0;
  lastBootId = null;
  lastSeq = 0;
  failedBeforeFirstConnect = false;
  resyncHandlers.clear();
  safetyHandlers.clear();
  disarmSafetyNet();
  lastPoke = 0;
  if (pokeTimer) clearTimeout(pokeTimer);
  pokeTimer = null;
}

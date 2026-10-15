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
 * Events are signals. Consumers must refetch over REST on (re)connect to
 * recover anything missed while offline.
 */
import { io, type Socket } from "socket.io-client";
import { auth } from "@/integrations/backend/auth";

const isBrowser = typeof window !== "undefined";

let socket: Socket | null = null;
let connectCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;
let authSub: { unsubscribe: () => void } | null = null;

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
  });
  // A middleware rejection ("unauthorized", "unavailable") is final for that
  // attempt and Socket.IO won't retry it itself (s.active is false). Transport
  // errors leave s.active true and use Socket.IO's own reconnection.
  s.on("connect_error", () => {
    if (!s.active) scheduleRetry();
  });
  // Server dropped us (token expired without refresh): Socket.IO won't retry.
  s.on("disconnect", (reason) => {
    if (reason === "io server disconnect") scheduleRetry();
  });

  socket = s;
  return s;
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
  connectIfPossible();
}

function disconnectSocket() {
  clearRetry();
  retryDelay = 2000;
  socket?.disconnect();
}

export function stopRealtime() {
  authSub?.unsubscribe();
  authSub = null;
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
  lastPoke = 0;
  if (pokeTimer) clearTimeout(pokeTimer);
  pokeTimer = null;
}

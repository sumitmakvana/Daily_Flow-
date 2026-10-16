/**
 * Persistent-session logic for the Operon Android and Desktop apps (not used by the website).
 *
 * The website keeps its ordinary Keycloak client (`execution-os`), whose refresh token dies with
 * the SSO session (the 8-hour limit). The apps log in against a separate client (`operon-app`)
 * with the `offline_access` scope, so their refresh token is an *offline* token that lives in an
 * offline session governed by the offline-session settings, not the SSO session. That token is
 * only ever kept in OS-protected storage (see secure-token-store.ts) and is revoked on logout.
 *
 * Nothing in here logs or returns tokens other than to its caller.
 */
import type { SecureTokenStore } from "@/lib/secure-token-store";

export const APP_CLIENT_ID = "operon-app";
export const WEB_CLIENT_ID = "execution-os";
const REALM = "lovable";

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
}

/** What we persist: the refresh token and the client that issued it. */
export interface StoredSession {
  c: string;
  t: string;
}

export type RefreshOutcome =
  | { status: "ok"; tokens: TokenResponse }
  | { status: "invalid" } // session ended / revoked / expired: user must sign in again
  | { status: "network" }; // transient: keep the stored session and retry later

const tokenUrl = (base: string) => `${base}/realms/${REALM}/protocol/openid-connect/token`;

async function post(url: string, params: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
}

/** Sign in with email/password. Prefers the offline-capable app client, falling back to the web client. */
export async function passwordLogin(
  authBase: string,
  username: string,
  password: string,
): Promise<{ tokens: TokenResponse; clientId: string; offline: boolean }> {
  const attempt = (clientId: string, scope: string) =>
    post(tokenUrl(authBase), {
      grant_type: "password",
      client_id: clientId,
      username,
      password,
      scope,
    });

  let clientId = APP_CLIENT_ID;
  let res = await attempt(clientId, "openid profile email offline_access");
  if (!res.ok) {
    const err = (await res
      .clone()
      .json()
      .catch(() => ({}))) as { error?: string };
    // Keycloak not configured for the app yet: keep working with a normal (non-persistent) session.
    if (err.error === "invalid_client" || err.error === "invalid_scope") {
      console.warn(
        "[auth] Keycloak client 'operon-app' / offline_access is not configured; session will not persist.",
      );
      clientId = WEB_CLIENT_ID;
      res = await attempt(clientId, "openid profile email");
    }
  }
  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { error_description?: string };
    throw new Error(errData.error_description || "Invalid username or password");
  }
  const tokens = (await res.json()) as TokenResponse;
  return {
    tokens,
    clientId,
    offline:
      clientId === APP_CLIENT_ID && (tokens.scope ?? "").split(" ").includes("offline_access"),
  };
}

/** Exchange the stored refresh token for fresh tokens. Never throws. */
export async function refreshTokens(authBase: string, s: StoredSession): Promise<RefreshOutcome> {
  try {
    const res = await post(tokenUrl(authBase), {
      grant_type: "refresh_token",
      client_id: s.c,
      refresh_token: s.t,
    });
    if (res.ok) return { status: "ok", tokens: (await res.json()) as TokenResponse };
    // 400 invalid_grant (expired/revoked/not found) and 401: the session is gone for good.
    if (res.status === 400 || res.status === 401) return { status: "invalid" };
    return { status: "network" };
  } catch {
    return { status: "network" };
  }
}

/** Best-effort server-side revocation on explicit sign-out. */
export async function revokeSession(authBase: string, s: StoredSession): Promise<void> {
  const base = `${authBase}/realms/${REALM}/protocol/openid-connect`;
  const params = { client_id: s.c, token: s.t, token_type_hint: "refresh_token" };
  await Promise.allSettled([
    post(`${base}/revoke`, params),
    post(`${base}/logout`, { client_id: s.c, refresh_token: s.t }),
  ]);
}

export async function readStored(store: SecureTokenStore): Promise<StoredSession | null> {
  try {
    const raw = await store.get();
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredSession>;
    return typeof v.c === "string" && typeof v.t === "string" ? { c: v.c, t: v.t } : null;
  } catch {
    return null;
  }
}

export async function writeStored(store: SecureTokenStore, s: StoredSession): Promise<boolean> {
  try {
    await store.set(JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export async function clearStored(store: SecureTokenStore): Promise<void> {
  try {
    await store.remove();
  } catch {
    /* nothing more we can do */
  }
}

/** Seconds until a JWT access token expires (negative if already expired; 0 if unparsable). */
export function secondsUntilExpiry(accessToken: string | undefined | null): number {
  if (!accessToken) return 0;
  try {
    const part = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(part)) as { exp?: number };
    return typeof exp === "number" ? exp - Math.floor(Date.now() / 1000) : 0;
  } catch {
    return 0;
  }
}

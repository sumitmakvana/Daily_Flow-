/**
 * Backend abstraction — auth surface with Keycloak support.
 *
 * Implements standard OIDC authentication via Keycloak. Supports redirect flow
 * and direct grant (ROPC) flow to keep the existing login page UI working.
 */
import Keycloak from "keycloak-js";
import {
  NATIVE_CLIENT_ID,
  WEB_CLIENT_ID,
  WEB_SCOPE,
  resolveAuthProfile,
  type AuthProfile,
} from "./auth-profile";

// Check if window is defined (for SSR safety)
const isBrowser = typeof window !== "undefined";

let keycloak: Keycloak | null = null;

// Website: execution-os, no secure storage. Android/Electron with the persistent-login flag on
// and secure storage available: operon-app (see auth-profile.ts).
const profile: AuthProfile = isBrowser
  ? resolveAuthProfile()
  : { clientId: WEB_CLIENT_ID, scope: WEB_SCOPE, store: null };
const secureStore = profile.store;
const native = secureStore !== null;
let authBase = "";

if (isBrowser) {
  // Keycloak runs on AUTH_DOMAIN (http://localhost:7052 in dev, or custom in prod)
  // We determine the auth URL dynamically or fallback to localhost:7052
  const authUrl = window.location.origin.includes("localhost")
    ? "http://localhost:7052"
    : `${window.location.protocol}//${window.location.host.replace("7050", "7052")}`;
  authBase = authUrl;

  keycloak = new Keycloak({
    url: authUrl,
    realm: "lovable",
    clientId: profile.clientId,
  });
}

/* ------------------------- native (operon-app) session ------------------------- */

const SECURE_RT_KEY = "refresh_token";
const PENDING_REVOKE_KEY = "pending_revoke";
const CLIENT_MARKER_KEY = "kc_client";
const REFRESH_LOCK = "operon-native-refresh";
const START_RETRY_DELAYS_MS = [1000, 3000];
const REVOKE_TIMEOUT_MS = 8000;

const oidcUrl = (endpoint: string) =>
  `${authBase}/realms/lovable/protocol/openid-connect/${endpoint}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function decodeJwtPayload(token: string): any {
  const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(window.atob(padded));
}

/** Reads secure storage: string = value, null = absent, undefined = the read itself failed. */
async function readSecure(key: string): Promise<string | null | undefined> {
  try {
    return (await secureStore!.get(key)) ?? null;
  } catch {
    return undefined;
  }
}

/** Persists the refresh token: Keystore/safeStorage on native, localStorage on the website. */
async function saveRefreshToken(token: string | null | undefined): Promise<void> {
  if (secureStore) {
    try {
      if (token) await secureStore.set(SECURE_RT_KEY, token);
      else await secureStore.remove(SECURE_RT_KEY);
    } catch (err) {
      console.error("Failed to write secure refresh token");
    }
    return;
  }
  if (token) window.localStorage.setItem("kc_refresh_token", token);
  else window.localStorage.removeItem("kc_refresh_token");
}

function setSessionTokens(access: string, refresh: string | undefined, idToken?: string) {
  const tokenParsed = decodeJwtPayload(access);
  keycloak!.token = access;
  keycloak!.refreshToken = refresh;
  keycloak!.idToken = idToken ?? keycloak!.idToken;
  keycloak!.tokenParsed = tokenParsed;
  keycloak!.authenticated = true;
  keycloak!.subject = tokenParsed.sub;
  window.localStorage.setItem("kc_token", access);
}

/** The shared (cross-window) access token from localStorage, if still valid for `seconds`. */
function storedAccessTokenValidFor(seconds: number): string | null {
  const token = window.localStorage.getItem("kc_token");
  if (!token) return null;
  try {
    const exp = decodeJwtPayload(token).exp;
    return exp && exp - Date.now() / 1000 > seconds ? token : null;
  } catch {
    return null;
  }
}

async function clearNativeSession() {
  window.localStorage.removeItem("kc_token");
  window.localStorage.removeItem("kc_refresh_token");
  await saveRefreshToken(null);
  if (keycloak) {
    keycloak.token = undefined;
    keycloak.refreshToken = undefined;
    keycloak.idToken = undefined;
    keycloak.tokenParsed = undefined;
    keycloak.authenticated = false;
    keycloak.subject = undefined;
  }
}

type GrantResult =
  | { kind: "ok"; data: any }
  | { kind: "invalid" } // invalid_grant only: the refresh token is dead, log in again
  | { kind: "unavailable" }; // network, 5xx, or any other rejection: keep the stored token

async function nativeGrant(params: Record<string, string>): Promise<GrantResult> {
  try {
    const res = await fetch(oidcUrl("token"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: NATIVE_CLIENT_ID, ...params }),
    });
    if (res.ok) return { kind: "ok", data: await res.json() };
    if (res.status === 400 || res.status === 401) {
      const body = await res.json().catch(() => null);
      if (body?.error === "invalid_grant") return { kind: "invalid" };
    }
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

type RefreshOutcome = "valid" | "refreshed" | "adopted" | "unavailable" | "invalid" | "none";

/** Must run under the cross-window refresh lock. */
async function refreshCore(minValiditySeconds: number): Promise<RefreshOutcome> {
  const exp = keycloak?.tokenParsed?.exp;
  if (keycloak?.token && exp && exp - Date.now() / 1000 > minValiditySeconds) return "valid";

  const stored = await readSecure(SECURE_RT_KEY);
  if (stored === undefined) return "unavailable";
  const refreshToken = stored ?? keycloak?.refreshToken;
  if (!refreshToken) return "none";

  // Another window may have refreshed while we waited for the lock: adopt its token.
  const shared = storedAccessTokenValidFor(minValiditySeconds);
  if (shared && shared !== keycloak?.token) {
    setSessionTokens(shared, refreshToken);
    return "adopted";
  }

  const result = await nativeGrant({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (result.kind === "ok") {
    const next = result.data.refresh_token ?? refreshToken;
    setSessionTokens(result.data.access_token, next, result.data.id_token);
    await saveRefreshToken(next);
    return "refreshed";
  }
  if (result.kind === "invalid") {
    await clearNativeSession();
    return "invalid";
  }
  return "unavailable";
}

/** Serializes refreshes across windows (Electron quick-notes + main) so a token is never raced. */
function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as any).locks;
  return locks?.request ? locks.request(REFRESH_LOCK, fn) : fn();
}

let nativeRefreshInFlight: Promise<RefreshOutcome> | null = null;

function nativeRefresh(minValiditySeconds: number): Promise<RefreshOutcome> {
  if (nativeRefreshInFlight) return nativeRefreshInFlight;
  nativeRefreshInFlight = (async () => {
    const wasAuthenticated = !!keycloak?.authenticated;
    const outcome = await withRefreshLock(() => refreshCore(minValiditySeconds));
    if (outcome === "refreshed" || outcome === "adopted") {
      if (wasAuthenticated) {
        listeners.forEach((cb) => cb("TOKEN_REFRESHED", getSessionSync()));
      } else {
        // Recovered after a failed start: the UI must learn the user is signed in.
        await provisionUserProfile();
        listeners.forEach((cb) => cb("SIGNED_IN", getSessionSync()));
      }
    } else if (outcome === "invalid") {
      listeners.forEach((cb) => cb("SIGNED_OUT", null));
    }
    return outcome;
  })().finally(() => {
    nativeRefreshInFlight = null;
  });
  return nativeRefreshInFlight;
}

/** Ends the online session and revokes the offline token. True once the revoke call succeeded. */
async function revokeRefreshToken(token: string): Promise<boolean> {
  const post = async (endpoint: string, params: Record<string, string>) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REVOKE_TIMEOUT_MS);
    try {
      return await fetch(oidcUrl(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: NATIVE_CLIENT_ID, ...params }),
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const [, revoke] = await Promise.allSettled([
    post("logout", { refresh_token: token }),
    post("revoke", { token, token_type_hint: "refresh_token" }),
  ]);
  return revoke.status === "fulfilled" && revoke.value.ok;
}

let pendingRevokeInFlight: Promise<void> | null = null;

/** Finishes a logout whose revoke call failed (e.g. offline) so the offline session still dies. */
function retryPendingRevoke(): Promise<void> {
  pendingRevokeInFlight ??= (async () => {
    const token = await readSecure(PENDING_REVOKE_KEY);
    if (!token) return;
    if (await revokeRefreshToken(token)) {
      await secureStore!.remove(PENDING_REVOKE_KEY).catch(() => {});
    }
  })().finally(() => {
    pendingRevokeInFlight = null;
  });
  return pendingRevokeInFlight;
}

let kcRedirectInit: Promise<boolean> | null = null;

/** keycloak-js init, needed only to process a redirect login / sign-up return on native. */
function ensureNativeKcInit(): Promise<boolean> {
  kcRedirectInit ??= keycloak!.init({ pkceMethod: "S256", checkLoginIframe: false });
  return kcRedirectInit;
}

async function provisionUserProfile() {
  try {
    const userId = keycloak?.tokenParsed?.sub;
    const email = keycloak?.tokenParsed?.email;
    const name = (keycloak?.tokenParsed as any)?.name || keycloak?.tokenParsed?.preferred_username;
    if (userId && email) {
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.rpc("ensure_user_profile", {
        user_id: userId,
        user_email: email,
        user_name: name || email.split("@")[0],
      });
    }
  } catch (err) {
    console.error("Failed to auto-provision user profile:", err);
  }
}

async function initNative(): Promise<boolean> {
  // Tokens left by an execution-os session (pre-upgrade) cannot be refreshed by operon-app.
  if (window.localStorage.getItem(CLIENT_MARKER_KEY) !== NATIVE_CLIENT_ID) {
    window.localStorage.removeItem("kc_token");
    window.localStorage.setItem(CLIENT_MARKER_KEY, NATIVE_CLIENT_ID);
  }
  window.localStorage.removeItem("kc_refresh_token");
  void retryPendingRevoke();

  let outcome = await withRefreshLock(() => refreshCore(70));
  for (const delay of START_RETRY_DELAYS_MS) {
    if (outcome !== "unavailable") break;
    await sleep(delay);
    outcome = await withRefreshLock(() => refreshCore(70));
  }
  if (outcome === "unavailable") {
    // Still offline/unreachable: run on the cached access token if it is usable; keep the refresh
    // token either way and let the timer / resume / online triggers retry.
    const rt = await readSecure(SECURE_RT_KEY);
    const cached = rt ? storedAccessTokenValidFor(10) : null;
    if (rt && cached) {
      setSessionTokens(cached, rt);
      outcome = "adopted";
    }
  }

  let authenticated = outcome === "valid" || outcome === "refreshed" || outcome === "adopted";
  if (outcome === "none") {
    try {
      authenticated = await ensureNativeKcInit();
      if (authenticated && keycloak?.token) {
        window.localStorage.setItem("kc_token", keycloak.token);
        await saveRefreshToken(keycloak.refreshToken);
        window.localStorage.removeItem("kc_refresh_token");
      }
    } catch (err) {
      console.error("Failed to initialize Keycloak:", err);
    }
  }

  if (authenticated) {
    await provisionUserProfile();
    listeners.forEach((cb) => cb("SIGNED_IN", getSessionSync()));
  } else {
    window.localStorage.removeItem("kc_token");
    listeners.forEach((cb) => cb("SIGNED_OUT", null));
  }

  const recover = () => {
    void retryPendingRevoke();
    void nativeRefresh(70);
  };
  setInterval(() => void nativeRefresh(70), 60000);
  window.addEventListener("online", recover);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") recover();
  });
  return authenticated;
}

// Keep track of auth listeners
const listeners = new Set<(event: string, session: any) => void | Promise<void>>();

let initPromise: Promise<boolean> | null = null;

export function initKeycloak(): Promise<boolean> {
  if (!isBrowser) return Promise.resolve(false);
  if (initPromise) return initPromise;
  if (native) {
    initPromise = initNative();
    return initPromise;
  }

  const savedToken = window.localStorage.getItem("kc_token");
  const savedRefreshToken = window.localStorage.getItem("kc_refresh_token");

  initPromise = keycloak!
    .init({
      pkceMethod: "S256",
      checkLoginIframe: false,
      token: savedToken || undefined,
      refreshToken: savedRefreshToken || undefined,
    })
    .then(async (authenticated) => {
      if (authenticated && keycloak?.token) {
        window.localStorage.setItem("kc_token", keycloak.token);
        if (keycloak.refreshToken) {
          window.localStorage.setItem("kc_refresh_token", keycloak.refreshToken);
        } else {
          window.localStorage.removeItem("kc_refresh_token");
        }

        // Auto-provision user profile in the database
        try {
          const userId = keycloak.tokenParsed?.sub;
          const email = keycloak.tokenParsed?.email;
          const name =
            (keycloak.tokenParsed as any)?.name || keycloak.tokenParsed?.preferred_username;
          if (userId && email) {
            const { supabase } = await import("@/integrations/supabase/client");
            await supabase.rpc("ensure_user_profile", {
              user_id: userId,
              user_email: email,
              user_name: name || email.split("@")[0],
            });
          }
        } catch (err) {
          console.error("Failed to auto-provision user profile:", err);
        }

        // Trigger listeners
        const session = getSessionSync();
        listeners.forEach((cb) => cb("SIGNED_IN", session));
      } else {
        window.localStorage.removeItem("kc_token");
        window.localStorage.removeItem("kc_refresh_token");
        listeners.forEach((cb) => cb("SIGNED_OUT", null));
      }

      // Periodically refresh token to ensure it stays valid
      setInterval(() => {
        keycloak
          ?.updateToken(70)
          .then((refreshed) => {
            if (refreshed && keycloak?.token) {
              window.localStorage.setItem("kc_token", keycloak.token);
              const session = getSessionSync();
              listeners.forEach((cb) => cb("TOKEN_REFRESHED", session));
            }
          })
          .catch(() => {
            console.error("Failed to refresh Keycloak token");
          });
      }, 60000);

      return authenticated;
    })
    .catch((err) => {
      console.error("Failed to initialize Keycloak:", err);
      return false;
    });

  return initPromise;
}

function getSessionSync() {
  if (!isBrowser || !keycloak?.authenticated || !keycloak?.token) return null;
  return {
    access_token: keycloak.token,
    token_type: "bearer",
    expires_in: 43200, // 12 hours (43200 seconds)
    refresh_token: keycloak.refreshToken || "",
    user: {
      id: keycloak.tokenParsed?.sub || "",
      aud: "authenticated",
      role: "authenticated",
      email: keycloak.tokenParsed?.email || "",
      email_confirmed_at: new Date().toISOString(),
      user_metadata: {
        display_name:
          (keycloak.tokenParsed as any)?.name || keycloak.tokenParsed?.preferred_username || "",
      },
      app_metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

/**
 * Refresh the access token right away (e.g. when the mobile app returns from the
 * background, where the 60s interval timer is throttled/suspended).
 */
export async function refreshSessionNow(): Promise<void> {
  if (native) {
    await initKeycloak();
    await nativeRefresh(70);
    return;
  }
  if (!isBrowser || !keycloak?.authenticated) return;
  try {
    if (await keycloak.updateToken(70)) {
      if (keycloak.token) window.localStorage.setItem("kc_token", keycloak.token);
      if (keycloak.refreshToken) {
        window.localStorage.setItem("kc_refresh_token", keycloak.refreshToken);
      }
      const session = getSessionSync();
      listeners.forEach((cb) => cb("TOKEN_REFRESHED", session));
    }
  } catch {
    console.error("Failed to refresh Keycloak token on resume");
  }
}

export const auth = {
  signInWithPassword: async (args: { email?: string; password?: string }) => {
    if (!isBrowser) return { error: new Error("Not in browser") };
    await initKeycloak();

    if (keycloak?.authenticated) {
      return { data: { session: getSessionSync() }, error: null };
    }

    // Direct Grant (ROPC) flow if email & password are provided
    if (args.email && args.password) {
      try {
        const tokenUrl = `${keycloak!.authServerUrl || authBase}/realms/lovable/protocol/openid-connect/token`;
        const params = new URLSearchParams({
          grant_type: "password",
          client_id: profile.clientId,
          username: args.email,
          password: args.password,
          scope: profile.scope,
        });

        const res = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error_description || "Invalid username or password");
        }

        const data = await res.json();

        // Parse token payload safely
        const base64Url = data.access_token.split(".")[1];
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const tokenParsed = JSON.parse(window.atob(base64));

        // Load session tokens into Keycloak state manually to avoid duplicate init() call error
        keycloak!.token = data.access_token;
        keycloak!.refreshToken = data.refresh_token;
        keycloak!.idToken = data.id_token;
        keycloak!.tokenParsed = tokenParsed;
        keycloak!.authenticated = true;
        keycloak!.subject = tokenParsed.sub;

        if (keycloak!.token) {
          window.localStorage.setItem("kc_token", keycloak!.token);
        } else {
          window.localStorage.removeItem("kc_token");
        }
        await saveRefreshToken(keycloak!.refreshToken);

        // Auto-provision user profile in the database
        const userId = keycloak!.tokenParsed?.sub;
        const email = keycloak!.tokenParsed?.email;
        const name =
          (keycloak!.tokenParsed as any)?.name || keycloak!.tokenParsed?.preferred_username;
        if (userId && email) {
          const { supabase } = await import("@/integrations/supabase/client");
          await supabase.rpc("ensure_user_profile", {
            user_id: userId,
            user_email: email,
            user_name: name || email.split("@")[0],
          });
        }

        const session = getSessionSync();
        listeners.forEach((cb) => cb("SIGNED_IN", session));
        return { data: { session }, error: null };
      } catch (err: any) {
        return { data: { session: null }, error: err };
      }
    }

    // Default: Redirect to Keycloak authorization page
    if (native) await ensureNativeKcInit();
    await keycloak!.login({
      redirectUri: window.location.origin + "/login",
      ...(native ? { scope: profile.scope } : {}),
    });
    return { data: { session: null }, error: null };
  },

  signUp: async (args: any) => {
    if (!isBrowser) return { error: new Error("Not in browser") };
    await initKeycloak();
    if (native) await ensureNativeKcInit();
    await keycloak!.register({
      redirectUri: window.location.origin + "/login",
      ...(native ? { scope: profile.scope } : {}),
    });
    return { data: { user: null }, error: null };
  },

  signOut: async () => {
    if (!isBrowser) return { error: null, redirected: false };
    if (native) {
      // Record a pending revoke first, wipe the local session, then revoke server-side (ends the
      // online and offline sessions). If the revoke fails (offline), it is retried on next start.
      const rt = (await readSecure(SECURE_RT_KEY)) ?? keycloak?.refreshToken;
      if (rt) await secureStore!.set(PENDING_REVOKE_KEY, rt).catch(() => {});
      await clearNativeSession();
      listeners.forEach((cb) => cb("SIGNED_OUT", null));
      if (rt && (await revokeRefreshToken(rt))) {
        await secureStore!.remove(PENDING_REVOKE_KEY).catch(() => {});
      }
      return { error: null, redirected: false };
    }
    window.localStorage.removeItem("kc_token");
    window.localStorage.removeItem("kc_refresh_token");
    if (keycloak?.authenticated) {
      await keycloak.logout({
        redirectUri: window.location.origin + "/login",
      });
      return { error: null, redirected: true };
    }
    return { error: null, redirected: false };
  },

  getSession: async () => {
    if (!isBrowser) return { data: { session: null }, error: null };
    await initKeycloak();
    return { data: { session: getSessionSync() }, error: null };
  },

  getUser: async () => {
    if (!isBrowser) return { data: { user: null }, error: null };
    await initKeycloak();
    const session = getSessionSync();
    return { data: { user: session ? session.user : null }, error: null };
  },

  onAuthStateChange: (cb: (event: string, session: any) => void | Promise<void>) => {
    listeners.add(cb);

    if (isBrowser) {
      initKeycloak().then(() => {
        cb(keycloak?.authenticated ? "SIGNED_IN" : "SIGNED_OUT", getSessionSync());
      });
    }

    return {
      data: {
        subscription: {
          unsubscribe: () => {
            listeners.delete(cb);
          },
        },
      },
    };
  },
};

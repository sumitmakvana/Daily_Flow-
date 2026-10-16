/**
 * Backend abstraction — auth surface with Keycloak support.
 *
 * Implements standard OIDC authentication via Keycloak. Supports redirect flow
 * and direct grant (ROPC) flow to keep the existing login page UI working.
 */
import Keycloak from "keycloak-js";
import { getSecureTokenStore } from "@/lib/secure-token-store";
import {
  APP_CLIENT_ID,
  WEB_CLIENT_ID,
  clearStored,
  passwordLogin,
  readStored,
  refreshTokens,
  revokeSession,
  secondsUntilExpiry,
  writeStored,
  type RefreshOutcome,
  type StoredSession,
  type TokenResponse,
} from "@/lib/app-session";

// Check if window is defined (for SSR safety)
const isBrowser = typeof window !== "undefined";

let keycloak: Keycloak | null = null;

/**
 * App mode = the Android / Desktop apps, i.e. an environment with OS-protected token storage.
 * There the session is a persistent offline session (see app-session.ts). The website never
 * gets a secure store, so it keeps the original Keycloak behaviour untouched.
 */
const secureStore = isBrowser ? getSecureTokenStore() : null;
const APP_MODE = secureStore !== null;
let authBaseUrl = "";

if (isBrowser) {
  // Keycloak runs on AUTH_DOMAIN (http://localhost:7052 in dev, or custom in prod)
  // We determine the auth URL dynamically or fallback to localhost:7052
  const authUrl = window.location.origin.includes("localhost")
    ? "http://localhost:7052"
    : `${window.location.protocol}//${window.location.host.replace("7050", "7052")}`;

  authBaseUrl = authUrl;
  keycloak = new Keycloak({
    url: authUrl,
    realm: "lovable",
    clientId: APP_MODE ? APP_CLIENT_ID : WEB_CLIENT_ID,
  });
}

// Keep track of auth listeners
const listeners = new Set<(event: string, session: any) => void | Promise<void>>();

let initPromise: Promise<boolean> | null = null;

export function initKeycloak(): Promise<boolean> {
  if (!isBrowser) return Promise.resolve(false);
  if (initPromise) return initPromise;
  if (APP_MODE) {
    initPromise = initAppSession();
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

/* ------------------------------------------------------------------ */
/* App mode (Android / Desktop): persistent offline session            */
/* ------------------------------------------------------------------ */

let appSession: StoredSession | null = null;
let refreshInFlight: Promise<RefreshOutcome["status"]> | null = null;
let appLoopStarted = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emit(event: string) {
  const session = getSessionSync();
  listeners.forEach((cb) => cb(event, session));
}

function clearLocalTokens() {
  if (keycloak) {
    keycloak.token = undefined;
    keycloak.refreshToken = undefined;
    keycloak.idToken = undefined;
    keycloak.tokenParsed = undefined;
    keycloak.authenticated = false;
    keycloak.subject = undefined;
  }
  window.localStorage.removeItem("kc_token");
  window.localStorage.removeItem("kc_refresh_token");
}

/** Load a token response into the Keycloak instance and persist the refresh token securely. */
async function acceptTokens(tokens: TokenResponse, event: "SIGNED_IN" | "TOKEN_REFRESHED") {
  const payload = tokens.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const parsed = JSON.parse(window.atob(payload));
  const kc = keycloak!;
  kc.token = tokens.access_token;
  kc.refreshToken = tokens.refresh_token;
  kc.idToken = tokens.id_token;
  kc.tokenParsed = parsed;
  kc.authenticated = true;
  kc.subject = parsed.sub;
  // The access token is short-lived and is what the data layer reads; the refresh token never
  // goes to localStorage in app mode.
  window.localStorage.setItem("kc_token", tokens.access_token);
  window.localStorage.removeItem("kc_refresh_token");

  if (appSession) {
    appSession = { c: appSession.c, t: tokens.refresh_token || appSession.t };
    if (!(await writeStored(secureStore!, appSession))) {
      console.warn("[auth] could not persist the session securely; it will last until the app closes");
    }
  }
  if (event === "SIGNED_IN") await provisionProfile();
  emit(event);
}

async function provisionProfile() {
  try {
    const userId = keycloak?.tokenParsed?.sub;
    const email = keycloak?.tokenParsed?.email;
    const name = (keycloak?.tokenParsed as any)?.name || keycloak?.tokenParsed?.preferred_username;
    if (userId && email) {
      const { supabase } = await import("@/integrations/supabase/client");
      await (supabase as any).rpc("ensure_user_profile", {
        user_id: userId,
        user_email: email,
        user_name: name || email.split("@")[0],
      });
    }
  } catch (err) {
    console.error("Failed to auto-provision user profile:", err);
  }
}

/** The session is definitively over (revoked/expired): wipe it and send the user to sign in. */
async function endAppSession() {
  const wasAuthenticated = !!keycloak?.authenticated;
  appSession = null;
  await clearStored(secureStore!);
  clearLocalTokens();
  emit("SIGNED_OUT");
  if (wasAuthenticated && window.location.pathname !== "/login") {
    window.location.replace("/login");
  }
}

/** One refresh at a time (refresh tokens may rotate, so parallel refreshes could invalidate each other). */
function doRefresh(): Promise<RefreshOutcome["status"]> {
  if (!appSession) return Promise.resolve("invalid");
  if (!refreshInFlight) {
    const session = appSession;
    refreshInFlight = (async () => {
      const wasAuthenticated = !!keycloak?.authenticated;
      const outcome = await refreshTokens(authBaseUrl, session);
      if (outcome.status === "ok") {
        await acceptTokens(outcome.tokens, wasAuthenticated ? "TOKEN_REFRESHED" : "SIGNED_IN");
      } else if (outcome.status === "invalid") {
        await endAppSession();
      }
      return outcome.status;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Refresh proactively when the access token is close to expiry (or missing, e.g. after a network outage). */
async function ensureFreshApp(minValiditySeconds = 120): Promise<void> {
  if (!appSession) {
    const stored = await readStored(secureStore!);
    if (!stored) return;
    appSession = stored;
  }
  if (keycloak?.authenticated && secondsUntilExpiry(keycloak.token) > minValiditySeconds) return;
  await doRefresh();
}

function startAppRefreshLoop() {
  if (appLoopStarted) return;
  appLoopStarted = true;
  setInterval(() => void ensureFreshApp(), 60_000);
  // Recover from network loss and from the app/PC waking up or returning to the foreground.
  window.addEventListener("online", () => void ensureFreshApp());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void ensureFreshApp();
  });
}

async function initAppSession(): Promise<boolean> {
  window.localStorage.removeItem("kc_refresh_token"); // legacy plain-text copy must not linger
  startAppRefreshLoop();
  const stored = await readStored(secureStore!);
  if (!stored) {
    clearLocalTokens();
    return false;
  }
  appSession = stored;
  let status = await doRefresh();
  // Right after a device/PC restart the network may not be up yet: retry briefly, never log out for that.
  for (let i = 1; status === "network" && i <= 3; i++) {
    await sleep(2000 * i);
    status = await doRefresh();
  }
  return status === "ok";
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
  if (APP_MODE) return ensureFreshApp();
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

    // Apps: password login against the offline-capable app client; tokens go to secure storage.
    if (APP_MODE && args.email && args.password) {
      try {
        const { tokens, clientId } = await passwordLogin(authBaseUrl, args.email, args.password);
        appSession = { c: clientId, t: tokens.refresh_token };
        await acceptTokens(tokens, "SIGNED_IN");
        return { data: { session: getSessionSync() }, error: null };
      } catch (err: any) {
        return { data: { session: null }, error: err };
      }
    }

    // Direct Grant (ROPC) flow if email & password are provided
    if (args.email && args.password) {
      try {
        const tokenUrl = `${keycloak!.authServerUrl}/realms/lovable/protocol/openid-connect/token`;
        const params = new URLSearchParams({
          grant_type: "password",
          client_id: "execution-os",
          username: args.email,
          password: args.password,
          scope: "openid profile email",
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
        if (keycloak!.refreshToken) {
          window.localStorage.setItem("kc_refresh_token", keycloak!.refreshToken);
        } else {
          window.localStorage.removeItem("kc_refresh_token");
        }

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
    await keycloak!.login({
      redirectUri: window.location.origin + "/login",
    });
    return { data: { session: null }, error: null };
  },

  signUp: async (args: any) => {
    if (!isBrowser) return { error: new Error("Not in browser") };
    await initKeycloak();
    await keycloak!.register({
      redirectUri: window.location.origin + "/login",
    });
    return { data: { user: null }, error: null };
  },

  signOut: async () => {
    if (!isBrowser) return { error: null, redirected: false };
    if (APP_MODE) {
      // Explicit logout: revoke the offline session server-side, then wipe every local copy.
      const stored = appSession ?? (await readStored(secureStore!));
      if (stored) await revokeSession(authBaseUrl, stored);
      appSession = null;
      await clearStored(secureStore!);
      clearLocalTokens();
      emit("SIGNED_OUT");
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

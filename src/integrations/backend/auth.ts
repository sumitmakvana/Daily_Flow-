/**
 * Backend abstraction — auth surface with Keycloak support.
 *
 * Implements standard OIDC authentication via Keycloak. Supports redirect flow
 * and direct grant (ROPC) flow to keep the existing login page UI working.
 */
import Keycloak from "keycloak-js";
import { isClientReadOnly } from "@/lib/read-only-fetch";

// Check if window is defined (for SSR safety)
const isBrowser = typeof window !== "undefined";

let keycloak: Keycloak | null = null;

if (isBrowser) {
  // Keycloak runs on AUTH_DOMAIN (http://localhost:7052 in dev, or custom in prod)
  // We determine the auth URL dynamically or fallback to localhost:7052
  const authUrl = window.location.origin.includes("localhost")
    ? "http://localhost:7052"
    : `${window.location.protocol}//${window.location.host.replace("7050", "7052")}`;

  keycloak = new Keycloak({
    url: authUrl,
    realm: "lovable",
    clientId: "execution-os",
  });
}

/**
 * Create the user's profile/role rows if they are missing (`ensure_user_profile`). It is idempotent
 * and only matters for a first login, so it runs once per user per browser session instead of on
 * every page load / reload. A failed call is not remembered, so the next load retries it.
 */
export async function ensureProfileOnce(userId: string, email: string, name: string): Promise<void> {
  const key = `ensured_profile:${userId}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
  } catch {
    // storage unavailable: fall through and just call it
  }
  const { supabase } = await import("@/integrations/supabase/client");
  const { error } = await supabase.rpc("ensure_user_profile", {
    user_id: userId,
    user_email: email,
    user_name: name || email.split("@")[0],
  });
  if (error) return;
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // ignore
  }
}

// Keep track of auth listeners
const listeners = new Set<(event: string, session: any) => void | Promise<void>>();

let initPromise: Promise<boolean> | null = null;

export function initKeycloak(): Promise<boolean> {
  if (!isBrowser) return Promise.resolve(false);
  if (initPromise) return initPromise;

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
          // Read-only builds never write a profile/role row at login.
          if (userId && email && !isClientReadOnly()) {
            await ensureProfileOnce(userId, email, name);
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
        if (userId && email && !isClientReadOnly()) {
          await ensureProfileOnce(userId, email, name);
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
    window.localStorage.removeItem("kc_token");
    window.localStorage.removeItem("kc_refresh_token");
    try {
      const sub = keycloak?.tokenParsed?.sub;
      if (sub) window.sessionStorage.removeItem(`ensured_profile:${sub}`);
    } catch {
      // ignore
    }
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

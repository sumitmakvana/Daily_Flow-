import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { auth } from "@/integrations/backend/auth";
import { getMyRoles } from "@/services/auth.functions";
import { stopRealtime } from "@/integrations/realtime/socket";
import type { AppRole } from "@/lib/types";

/**
 * Roles are shared by every `useAuth()` caller (there are dozens, one per task card among
 * them). Without sharing, each instance fetched `user_roles` on mount and again whenever the
 * session's `user` object changed identity, i.e. hundreds of identical requests per page.
 *
 * The cache is keyed by user id, de-duplicates in-flight requests, expires after
 * ROLES_TTL_MS (so a role change is picked up by the next mount), and is dropped on sign-out,
 * token refresh, or when the signed-in user changes. A plain "signed in" event for the user
 * already cached does NOT drop it: the Keycloak wrapper fires one for every new subscriber
 * (an "initial session" callback), and treating those as changes made each late-mounting
 * component refetch. Server functions do their own role checks and are unaffected.
 *
 * The route layout shares the same loader (`getRolesShared`) with a freshness limit, so one
 * page load costs one `user_roles` request instead of one per caller.
 */
export const ROLES_TTL_MS = 60_000;

type RolesEntry = { userId: string; at: number; promise: Promise<AppRole[]>; value?: AppRole[] };
let rolesEntry: RolesEntry | null = null;

/** Forget cached roles so the next `useAuth()` effect refetches them. */
export function invalidateRoles() {
  rolesEntry = null;
}

/**
 * The signed-in user's roles, shared with every other caller.
 *
 * `maxAgeMs` is how old a COMPLETED result may be to be reused (default ROLES_TTL_MS).
 * Pass 0 to always read fresh data (an in-flight request is still joined, so concurrent
 * callers never double-fetch). Authorization gates that must re-check on every navigation
 * pass 0.
 */
export function getRolesShared(userId: string, maxAgeMs: number = ROLES_TTL_MS): Promise<AppRole[]> {
  // Never share state across requests on the server.
  if (typeof window === "undefined") return getMyRoles();
  const e = rolesEntry;
  if (e && e.userId === userId) {
    const age = Date.now() - e.at;
    const pending = e.value === undefined;
    if (age < (pending ? ROLES_TTL_MS : maxAgeMs)) return e.promise;
  }
  const entry: RolesEntry = {
    userId,
    at: Date.now(),
    promise: getMyRoles().then(
      (rs) => {
        entry.value = rs;
        // An empty result (no token / transient error) is not worth remembering.
        if (rs.length === 0 && rolesEntry === entry) rolesEntry = null;
        return rs;
      },
      (err) => {
        if (rolesEntry === entry) rolesEntry = null;
        throw err;
      },
    ),
  };
  rolesEntry = entry;
  return entry.promise;
}

const sameRoles = (a: AppRole[], b: AppRole[]) => a.length === b.length && a.every((r, i) => r === b[i]);

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<AppRole[]>([]);
  // Bumped on auth events so mounted instances re-read roles once (via the shared cache).
  const [authTick, setAuthTick] = useState(0);

  useEffect(() => {
    const { data: { subscription } } = auth.onAuthStateChange((event, s) => {
      // Drop the shared roles only when something really changed: sign-out, a token refresh, or a
      // different user than the cached one. (Every new subscriber gets an immediate "SIGNED_IN"
      // for the current session; that must not wipe the cache.)
      const id = s?.user?.id ?? null;
      const identityChanged = rolesEntry !== null && rolesEntry.userId !== id;
      if (event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || id === null || identityChanged) {
        invalidateRoles();
        setAuthTick((n) => n + 1);
      }
      setSession(s);
      setUser(s?.user ?? null);
    });
    auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Keyed by id, not by the user object (its identity changes on every auth event).
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) { setRoles([]); return; }
    let cancelled = false;
    getRolesShared(userId)
      .then((rs) => { if (!cancelled) setRoles((prev) => (sameRoles(prev, rs) ? prev : (rs as AppRole[]))); })
      .catch(() => { if (!cancelled) setRoles([]); });
    return () => { cancelled = true; };
  }, [userId, authTick]);

  const isManager = roles.includes("manager") || roles.includes("admin");
  const isAdmin = roles.includes("admin");

  return { session, user, loading, roles, isManager, isAdmin };
}

export async function signOut() {
  invalidateRoles();
  stopRealtime();
  return await auth.signOut();
}

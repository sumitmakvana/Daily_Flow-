import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { auth } from "@/integrations/backend/auth";
import { getMyRoles } from "@/services/auth.functions";
import { stopRealtime } from "@/integrations/realtime/socket";
import type { AppRole } from "@/lib/types";
import { registerSessionReset, resetSessionCaches } from "@/lib/session-cache";

/**
 * Roles are shared by every `useAuth()` caller (there are dozens, one per task card among
 * them). Without sharing, each instance fetched `user_roles` on mount and again whenever the
 * session's `user` object changed identity, i.e. hundreds of identical requests per page.
 *
 * The cache is keyed by user id, de-duplicates in-flight requests, expires after
 * ROLES_TTL_MS, and is dropped on sign-out, when the signed-in user changes, and by
 * `invalidateRoles()` after a role edit. It is NOT dropped on a token refresh (same user, same
 * roles) nor on the plain "signed in" the Keycloak wrapper replays to every new subscriber:
 * treating those as changes made every mounted component refetch. Server functions and RLS do
 * their own role checks, so a role change reaching this browser late only delays UI gating.
 *
 * The route layout and route guards use the same loader (`getRolesShared`), so a session costs
 * one `user_roles` request per TTL instead of one per caller per navigation.
 */
export const ROLES_TTL_MS = 5 * 60_000;

type RolesEntry = { userId: string; at: number; promise: Promise<AppRole[]>; value?: AppRole[] };
let rolesEntry: RolesEntry | null = null;

/** Forget cached roles so the next `useAuth()` effect refetches them. */
export function invalidateRoles() {
  rolesEntry = null;
}
registerSessionReset(invalidateRoles);

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
  // The user id the roles above were last resolved for (so a page can wait for them instead of acting as a member first).
  const [rolesFor, setRolesFor] = useState<string | null>(null);
  // Bumped on auth events so mounted instances re-read roles once (via the shared cache).
  const [authTick, setAuthTick] = useState(0);

  useEffect(() => {
    const { data: { subscription } } = auth.onAuthStateChange((event, s) => {
      // Drop the shared roles only when the identity really changed: sign-out or a different user
      // than the cached one. A token refresh or the replayed "SIGNED_IN" must not wipe the cache.
      const id = s?.user?.id ?? null;
      const identityChanged = rolesEntry !== null && rolesEntry.userId !== id;
      if (event === "SIGNED_OUT" || id === null || identityChanged) {
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
    if (!userId) { setRoles([]); setRolesFor(null); return; }
    let cancelled = false;
    getRolesShared(userId)
      .then((rs) => { if (!cancelled) { setRoles((prev) => (sameRoles(prev, rs) ? prev : (rs as AppRole[]))); setRolesFor(userId); } })
      .catch(() => { if (!cancelled) { setRoles([]); setRolesFor(userId); } });
    return () => { cancelled = true; };
  }, [userId, authTick]);

  const isManager = roles.includes("manager") || roles.includes("admin");
  const isAdmin = roles.includes("admin");

  const rolesReady = !!userId && rolesFor === userId;

  return { session, user, loading, roles, rolesReady, isManager, isAdmin };
}

export async function signOut() {
  resetSessionCaches();
  stopRealtime();
  return await auth.signOut();
}

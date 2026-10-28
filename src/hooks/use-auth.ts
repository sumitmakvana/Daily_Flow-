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
 * ROLES_TTL_MS (so a role change is picked up by the next mount), and is dropped on any
 * sign-in / sign-out / token-refresh event. Route guards and server functions do their own
 * role checks and are unaffected.
 */
export const ROLES_TTL_MS = 60_000;

type RolesEntry = { userId: string; at: number; promise: Promise<AppRole[]>; value?: AppRole[] };
let rolesEntry: RolesEntry | null = null;

/** Forget cached roles so the next `useAuth()` effect refetches them. */
export function invalidateRoles() {
  rolesEntry = null;
}

function loadRoles(userId: string): Promise<AppRole[]> {
  // Never share state across requests on the server.
  if (typeof window === "undefined") return getMyRoles();
  const e = rolesEntry;
  if (e && e.userId === userId && Date.now() - e.at < ROLES_TTL_MS) return e.promise;
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
    const { data: { subscription } } = auth.onAuthStateChange((_event, s) => {
      invalidateRoles();
      setAuthTick((n) => n + 1);
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
    loadRoles(userId)
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

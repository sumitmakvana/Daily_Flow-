import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { auth } from "@/integrations/backend/auth";
import { getMyRoles } from "@/services/auth.functions";
import type { AppRole } from "@/lib/types";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<AppRole[]>([]);

  useEffect(() => {
    const { data: { subscription } } = auth.onAuthStateChange((_event, s) => {
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

  useEffect(() => {
    if (!user) { setRoles([]); return; }
    let cancelled = false;
    getMyRoles()
      .then((rs) => { if (!cancelled) setRoles(rs as AppRole[]); })
      .catch(() => { if (!cancelled) setRoles([]); });
    return () => { cancelled = true; };
  }, [user]);

  const isManager = roles.includes("manager") || roles.includes("admin");
  const isAdmin = roles.includes("admin");

  return { session, user, loading, roles, isManager, isAdmin };
}

export async function signOut() {
  return await auth.signOut();
}

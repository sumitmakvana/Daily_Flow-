import type { AppRole } from "@/lib/types";

/**
 * Returns the signed-in user's app_role list.
 *
 * Runs client-side so the supabase proxy can attach the Keycloak Bearer
 * token (stored in localStorage as "kc_token") to the PostgREST request.
 * The old server-function approach failed in self-hosted mode because the
 * server had no access to the browser's kc_token.
 */
export async function getMyRoles(): Promise<AppRole[]> {
  // Dynamically import to avoid SSR issues
  const { supabase, isSelfHosted } = await import("@/integrations/supabase/client");

  const isSelf = isSelfHosted();

  let userId: string | null = null;

  if (isSelf) {
    // Get current user id from Keycloak token
    const token = typeof window !== "undefined" ? window.localStorage.getItem("kc_token") : null;
    if (!token) return [];

    // Decode JWT to get the sub (user id)
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      userId = payload.sub ?? null;
    } catch {
      return [];
    }
  } else {
    // Get current user id from Supabase auth session
    try {
      const { data: { session } } = await supabase.auth.getSession();
      userId = session?.user?.id ?? null;
    } catch (err) {
      console.error("[getMyRoles] Error getting Supabase session:", err);
      return [];
    }
  }

  if (!userId) return [];

  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (error) {
    console.error("[getMyRoles] Error fetching roles:", error.message);
    return [];
  }
  return ((data ?? []) as Array<{ role: AppRole }>).map((r) => r.role);
}

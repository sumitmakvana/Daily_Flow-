import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { focusManager, useQueryClient } from "@tanstack/react-query";
import { auth } from "@/integrations/backend/auth";
import { getMyRoles } from "@/services/auth.functions";
import { AppShell } from "@/components/AppShell";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";

/**
 * Manager/admin-only path prefixes. Members hitting these get redirected to /my-day.
 * RLS still protects the data — this prevents UI flicker and broken empty states.
 */
const MANAGER_ONLY_PREFIXES = [
  "/manager",
  "/command",
  "/executive",
  "/forecast",
  "/intelligence",
  "/planning-suggestions",
  "/dashboard",
  "/planning",
  "/heatmap",
  "/analytics",
  "/exports",
  "/eod",
  "/workload",
  "/reports",
];

const ADMIN_ONLY_PREFIXES = ["/admin", "/configure"];

export const Route = createFileRoute("/_authenticated")({
  // SSR cannot read localStorage where the session lives, so the
  // server-side gate would 307 every refresh/deep-link to /login. Render
  // client-only and gate inside the component.
  ssr: false,
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    const { data } = await auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const location = useLocation();
  const [ready, setReady] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const queryClient = useQueryClient();

  // GLOBAL ROOT REALTIME ENGINE: Listens for any task change across the app
  // and refetches ALL active queries on any page/component globally.
  useRealtimeTasks(() => {
    console.log(
      "%c[GLOBAL REALTIME ENGINE] ⚡ Invalidation Triggered for ALL Active Queries Across Entire Application",
      "background: #2563eb; color: white; padding: 4px 10px; border-radius: 4px; font-weight: bold;",
    );
    // Force TanStack Query focus manager to true so background queries execute HTTP request immediately
    focusManager.setFocused(true);
    queryClient.invalidateQueries();
    queryClient.refetchQueries({ type: "active" });
  }, "global-root-realtime");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await auth.getSession();
      if (!sess.session) {
        const url = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
        window.location.replace(url);
        return;
      }
      try {
        const rs = await getMyRoles();
        if (cancelled) return;
        setRoles(rs as string[]);
      } catch {
        if (cancelled) return;
        setRoles([]);
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [location.pathname, location.search]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-xs text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const isAdmin = roles.includes("admin");
  const isManager = isAdmin || roles.includes("manager");
  const path = location.pathname;

  const needsAdmin = ADMIN_ONLY_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
  const needsManager = MANAGER_ONLY_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));

  if (needsAdmin && !isAdmin) {
    window.location.replace("/my-day");
    return null;
  }
  if (needsManager && !isManager) {
    window.location.replace("/my-day");
    return null;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

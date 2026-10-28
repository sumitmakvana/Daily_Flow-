import { createFileRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { auth } from "@/integrations/backend/auth";
import { getRolesShared } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { UnstartedTaskLeaveModal } from "@/components/UnstartedTaskLeaveModal";
import { MorningResumePromptModal } from "@/components/MorningResumePromptModal";
import { NotificationsProvider } from "@/hooks/use-notifications";

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
  // Pathname the current `roles` were read for. The gate below depends on the pathname and the
  // roles only, so a search-only change (e.g. `?tab=`) needs no new read.
  const rolesPathRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await auth.getSession();
      if (!sess.session) {
        const url = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
        window.location.replace(url);
        return;
      }
      if (rolesPathRef.current !== location.pathname) {
        try {
          // Always a fresh read for a new path (maxAge 0), but it joins a request that is already
          // in flight and its result is shared with every `useAuth()` below, so a page load is one request.
          const rs = await getRolesShared(sess.session.user.id, 0);
          if (cancelled) return;
          rolesPathRef.current = location.pathname;
          setRoles(rs as string[]);
        } catch {
          if (cancelled) return;
          setRoles([]);
        }
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
    <NotificationsProvider>
      <AppShell>
        <Outlet />
        <UnstartedTaskLeaveModal />
        <MorningResumePromptModal />
      </AppShell>
    </NotificationsProvider>
  );
}

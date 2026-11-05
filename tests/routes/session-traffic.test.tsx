import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// One simulated 30-minute session of a manager: 40 page navigations (each mounts 20 useAuth() consumers
// and the three profile readers), a token refresh every 4 minutes. Counts the requests that reach
// the network for `user_roles` and `profiles` (own row + people list).

let loc = { pathname: "/my-day", search: "" };
type Cb = (e: string, s: unknown) => void;
const subs = new Set<Cb>();
const session = () => ({ user: { id: "u1" } });
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (c: unknown) => c,
  redirect: (o: unknown) => o,
  useLocation: () => loc,
  Outlet: () => null,
}));
vi.mock("@/integrations/backend/auth", () => ({
  auth: {
    getSession: async () => ({ data: { session: session() } }),
    onAuthStateChange: (cb: Cb) => { subs.add(cb); return { data: { subscription: { unsubscribe: () => subs.delete(cb) } } }; },
    signOut: async () => ({}),
  },
}));
vi.mock("@/integrations/realtime/socket", () => ({ stopRealtime: vi.fn() }));
vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/UnstartedTaskLeaveModal", () => ({ UnstartedTaskLeaveModal: () => null }));
vi.mock("@/components/MorningResumePromptModal", () => ({ MorningResumePromptModal: () => null }));
vi.mock("@/hooks/use-notifications", () => ({ NotificationsProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));

const requests = { user_roles: 0, profile_me: 0, profiles_people: 0 };
vi.mock("@/services/auth.functions", () => ({ getMyRoles: async () => { requests.user_roles++; return ["manager"]; } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => cols === "display_name, email, avatar_url"
        ? { eq: () => ({ maybeSingle: async () => { requests.profile_me++; return { data: { display_name: "A", email: null, avatar_url: null }, error: null }; } }) }
        : (requests.profiles_people++, Promise.resolve({ data: [{ id: "u1", display_name: "A", avatar_url: null }], error: null })),
    }),
  },
}));

import { Route } from "@/routes/_authenticated";
import { useAuth } from "@/hooks/use-auth";
import { invalidateRoles } from "@/hooks/use-auth";
import { invalidateMyProfile, loadMyProfile } from "@/lib/my-profile";
import { invalidatePeople, loadPeople } from "@/lib/people";

const Layout = (Route as unknown as { component: () => JSX.Element }).component;
function Consumer() { useAuth(); return null; }
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

beforeEach(() => {
  invalidateRoles(); invalidateMyProfile(); invalidatePeople();
  Object.assign(requests, { user_roles: 0, profile_me: 0, profiles_people: 0 });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T09:00:00Z"));
});

describe("30-minute session traffic", () => {
  it("prints and bounds user_roles / profiles requests", async () => {
    const paths = ["/my-day", "/tasks", "/executive", "/team-capacity", "/leaves"];
    const { rerender } = render(<Layout />);
    for (let nav = 0; nav < 40; nav++) {
      vi.setSystemTime(Date.now() + 45_000); // 40 navs * 45s = 30 min
      if (nav % 5 === 4) await act(async () => { subs.forEach((cb) => cb("TOKEN_REFRESHED", session())); }); // ~every 3.75 min
      loc = { pathname: paths[nav % paths.length], search: "" };
      rerender(<Layout />);
      const page = render(<div>{Array.from({ length: 20 }, (_, i) => <Consumer key={i} />)}</div>);
      await flush();
      await Promise.all([loadMyProfile("u1"), loadMyProfile("u1"), loadMyProfile("u1"), loadPeople(), loadPeople()]);
      page.unmount();
    }
    console.log("TRAFFIC", JSON.stringify(requests));
    expect(requests.user_roles).toBeLessThanOrEqual(8); // 30 min / 5 min TTL (+ first load)
    expect(requests.profile_me).toBeLessThanOrEqual(8);
    expect(requests.profiles_people).toBeLessThanOrEqual(9);
  });
});

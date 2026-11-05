import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The /_authenticated layout is the role gate for every signed-in page. These tests pin two things:
//  1. it shares ONE role read with the components below it (it used to bypass the shared cache,
//     so every page load made 3-4 identical user_roles requests), and
//  2. roles are session-cached: navigating between pages costs no further read, a role edit
//     (invalidateRoles) or the TTL makes the next navigation re-check, and members are still turned
//     away from manager/admin pages.

let loc = { pathname: "/my-day", search: "" };
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
  redirect: (o: unknown) => o,
  useLocation: () => loc,
  Outlet: () => <div data-testid="outlet" />,
}));
vi.mock("@/integrations/backend/auth", () => ({
  auth: {
    getSession: async () => ({ data: { session: { user: { id: "u1" } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({}),
  },
}));
vi.mock("@/integrations/realtime/socket", () => ({ stopRealtime: vi.fn() }));
vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/UnstartedTaskLeaveModal", () => ({ UnstartedTaskLeaveModal: () => null }));
vi.mock("@/components/MorningResumePromptModal", () => ({ MorningResumePromptModal: () => null }));
vi.mock("@/hooks/use-notifications", () => ({ NotificationsProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));

const getMyRoles = vi.fn<() => Promise<string[]>>();
vi.mock("@/services/auth.functions", () => ({ getMyRoles: () => getMyRoles() }));

import { Route } from "@/routes/_authenticated";
import { invalidateRoles, useAuth } from "@/hooks/use-auth";

const Layout = (Route as unknown as { component: () => JSX.Element }).component;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

const replace = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  loc = { pathname: "/my-day", search: "" };
  invalidateRoles();
  getMyRoles.mockReset();
  getMyRoles.mockResolvedValue(["manager"]);
  replace.mockClear();
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, replace } });
});
afterEach(() => Object.defineProperty(window, "location", { configurable: true, value: realLocation }));

describe("authenticated layout: role reads", () => {
  it("one page load = one user_roles read, shared with the components rendered below it", async () => {
    function Child() {
      useAuth(); // AppShell, task cards, ... all call this
      return null;
    }
    const { findByTestId } = render(<><Layout /></>);
    await flush();
    expect(await findByTestId("outlet")).toBeTruthy();
    // Mount many consumers after the gate has opened, as the real page does.
    render(<div>{Array.from({ length: 25 }, (_, i) => <Child key={i} />)}</div>);
    await flush();
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(1);
  });

  it("a search-only change (e.g. switching ?tab=) does not read roles again", async () => {
    const { rerender } = render(<Layout />);
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(1);
    for (const search of ["?tab=a", "?tab=b", "?tab=c"]) {
      loc = { pathname: "/my-day", search };
      rerender(<Layout />);
      await flush();
    }
    expect(getMyRoles).toHaveBeenCalledTimes(1);
  });

  it("navigating to a different path reuses the session-cached roles", async () => {
    const { rerender } = render(<Layout />);
    await flush();
    expect(getMyRoles).toHaveBeenCalledTimes(1);
    for (const pathname of ["/tasks", "/my-day", "/executive"]) {
      loc = { pathname, search: "" };
      rerender(<Layout />);
      await flush();
    }
    expect(getMyRoles).toHaveBeenCalledTimes(1);
  });
});

describe("authenticated layout: the gate still works", () => {
  it("a manager can open a manager-only page", async () => {
    loc = { pathname: "/executive", search: "" };
    const { findByTestId } = render(<Layout />);
    await flush();
    expect(await findByTestId("outlet")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("a member is turned away from manager-only and admin-only pages", async () => {
    getMyRoles.mockResolvedValue(["member"]);
    loc = { pathname: "/executive", search: "" };
    const { queryByTestId, rerender } = render(<Layout />);
    await flush();
    expect(replace).toHaveBeenCalledWith("/my-day");
    expect(queryByTestId("outlet")).toBeNull();

    replace.mockClear();
    loc = { pathname: "/admin/users", search: "" };
    rerender(<Layout />);
    await flush();
    expect(replace).toHaveBeenCalledWith("/my-day");
  });

  it("a manager demoted (role cache invalidated) is stopped on the very next path", async () => {
    const { rerender } = render(<Layout />);
    await flush(); // on /my-day as a manager
    getMyRoles.mockResolvedValue(["member"]); // demoted
    invalidateRoles(); // what the admin screen / sign-out / user switch does
    loc = { pathname: "/executive", search: "" };
    rerender(<Layout />);
    await flush();
    expect(replace).toHaveBeenCalledWith("/my-day");
  });

  it("an unreadable roles result is treated as no roles (fails closed)", async () => {
    getMyRoles.mockResolvedValue([]);
    loc = { pathname: "/manager", search: "" };
    render(<Layout />);
    await flush();
    expect(replace).toHaveBeenCalledWith("/my-day");
  });

  it("an ordinary page opens for a member", async () => {
    getMyRoles.mockResolvedValue(["member"]);
    const { findByTestId } = render(<Layout />);
    await flush();
    expect(await findByTestId("outlet")).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});

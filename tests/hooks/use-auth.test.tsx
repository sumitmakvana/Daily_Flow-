import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { mockSupabase } from "../mocks/supabase";
import { useAuth, signOut } from "@/hooks/use-auth";

describe("useAuth", () => {
  beforeEach(() => {
    mockSupabase.reset();
    mockSupabase.auth.onAuthStateChange = vi.fn((cb: (e: string, s: unknown) => void) => {
      // immediately push a session
      setTimeout(() => cb("SIGNED_IN", { user: { id: "u1" } }), 0);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }) as never;
    mockSupabase.auth.getSession = vi.fn(async () => ({ data: { session: { user: { id: "u1" } } } })) as never;
  });

  it("loads session and roles", async () => {
    for (let i = 0; i < 5; i++) mockSupabase.queueResponse("select", { data: [{ role: "manager" }] });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user?.id).toBe("u1"));
    await waitFor(() => expect(result.current.isManager).toBe(true));
  });

  it("admin role flips both flags", async () => {
    for (let i = 0; i < 5; i++) mockSupabase.queueResponse("select", { data: [{ role: "admin" }] });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.isAdmin).toBe(true));
    expect(result.current.isManager).toBe(true);
  });

  it("no user clears roles", async () => {
    mockSupabase.auth.getSession = vi.fn(async () => ({ data: { session: null } })) as never;
    mockSupabase.auth.onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) as never;
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.roles).toEqual([]);
  });

  it("null role rows tolerated", async () => {
    mockSupabase.queueResponse("select", { data: null });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.user?.id).toBe("u1"));
  });

  it("signOut calls supabase.auth.signOut", async () => {
    await signOut();
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
  });
});

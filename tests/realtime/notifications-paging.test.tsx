import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mk = (i: number, read = false) => ({
  id: `n${i}`,
  user_id: "me",
  type: "task_assigned",
  title: `T${i}`,
  body: "b",
  task_id: null,
  read_at: read ? "2026-01-01T00:00:00Z" : null,
  // higher i = newer
  created_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
});

let all: ReturnType<typeof mk>[] = [];
const calls: Array<{ limit?: number; lt?: string; head?: boolean }> = [];

// A tiny PostgREST-like query: eq(user) / is(read_at,null) / lt(created_at) / order / limit.
function query(head: boolean) {
  const st = { lt: undefined as string | undefined, unreadOnly: false };
  const run = (limit?: number) => {
    calls.push({ limit, lt: st.lt, head });
    let rows = all.filter((r) => (st.lt ? r.created_at < st.lt : true) && (st.unreadOnly ? !r.read_at : true));
    rows = rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (head) return { count: rows.length, error: null, data: null };
    return { data: rows.slice(0, limit ?? rows.length), error: null };
  };
  const q: any = {
    eq: () => q,
    is: () => {
      st.unreadOnly = true;
      return q;
    },
    lt: (_c: string, v: string) => {
      st.lt = v;
      return q;
    },
    order: () => q,
    limit: async (n: number) => run(n),
    then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (_cols?: string, opts?: { head?: boolean }) => query(Boolean(opts?.head)),
      update: () => ({ eq: () => Object.assign(Promise.resolve({ error: null }), { is: async () => ({ error: null }) }) }),
    }),
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-browser-notifications", () => ({ showDesktopNotification: vi.fn() }));
vi.mock("@/integrations/realtime/socket", () => ({
  startRealtime: vi.fn(),
  stopRealtime: vi.fn(),
  onRealtime: () => () => {},
  onRealtimeResync: () => () => {},
  onRealtimeSafetyRefresh: () => () => {},
}));

import { NotificationsProvider, useNotifications } from "@/hooks/use-notifications";
const wrapper = ({ children }: { children: ReactNode }) => <NotificationsProvider>{children}</NotificationsProvider>;

beforeEach(() => {
  calls.length = 0;
});

describe("notifications paging", () => {
  it("loads one page of 50, not the whole history, and reports older ones exist", async () => {
    all = Array.from({ length: 120 }, (_, i) => mk(i)); // all unread
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items.length).toBe(50));
    expect(result.current.hasMore).toBe(true);
    expect(calls.find((c) => !c.head)?.limit).toBe(50);
  });

  it("the badge counts unread rows beyond the loaded page with a head-only count", async () => {
    all = Array.from({ length: 120 }, (_, i) => mk(i));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.unreadCount).toBe(120));
    expect(calls.some((c) => c.head)).toBe(true);
  });

  it("loadMore appends the next older page by cursor, without duplicates, until exhausted", async () => {
    all = Array.from({ length: 120 }, (_, i) => mk(i));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items.length).toBe(50));
    await act(async () => result.current.loadMore());
    expect(result.current.items.length).toBe(100);
    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.items.length).toBe(120));
    expect(result.current.hasMore).toBe(false);
    expect(new Set(result.current.items.map((n) => n.id)).size).toBe(120);
    expect(result.current.unreadCount).toBe(120);
  });

  it("a short list issues no extra count request", async () => {
    all = [mk(1), mk(2, true)];
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.items.length).toBe(2));
    expect(result.current.hasMore).toBe(false);
    expect(calls.some((c) => c.head)).toBe(false);
    expect(result.current.unreadCount).toBe(1);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Task } from "@/lib/types";

// Regression: a task list used to cost 2 attachment requests per card (one unused fetch in
// TaskCard and one from the closed TaskDetailModal it mounts). Cards must not fetch attachments
// until their detail modal is actually opened.

const list = vi.fn(async (_id: string) => []);
vi.mock("@/services/attachments", () => ({
  attachmentsService: { list: (id: string) => list(id), download: vi.fn(), upload: vi.fn(), remove: vi.fn() },
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1" }, isManager: false, isAdmin: false, roles: [] }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => undefined,
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));

import { TaskCard } from "@/components/TaskCard";
import { TaskDetailModal } from "@/components/TaskDetailModal";

const task = (i: number): Task =>
  ({
    id: `t${i}`,
    task_code: `T-${i}`,
    task_name: `Task ${i}`,
    assigned_to: "u1",
    status: "To Do",
    priority: "Medium",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    version: 1,
  }) as unknown as Task;

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

beforeEach(() => list.mockClear());

describe("task list request volume", () => {
  it("rendering many TaskCards makes no attachment requests", async () => {
    await act(async () => {
      render(
        wrap(
          <div>
            {Array.from({ length: 24 }, (_, i) => (
              <TaskCard key={i} task={task(i)} profiles={[]} userId="u1" canManage={false} onChanged={() => {}} />
            ))}
          </div>,
        ),
      );
    });
    expect(list).not.toHaveBeenCalled();
  }, 30_000); // cold-imports the whole TaskCard module tree, which is slow when the suite runs in parallel

  it("TaskDetailModal fetches attachments only while open, once per task", async () => {
    const t = task(1);
    const { rerender } = render(wrap(<TaskDetailModal open={false} onOpenChange={() => {}} task={t} profiles={[]} />));
    await act(async () => {});
    expect(list).not.toHaveBeenCalled();

    await act(async () => {
      rerender(wrap(<TaskDetailModal open={true} onOpenChange={() => {}} task={t} profiles={[]} />));
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith("t1");
  });
});

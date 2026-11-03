import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => { throw new Error("head counts must not run when the rpc works"); } },
}));

import { countersFromRpc, fetchTaskCounters } from "@/lib/task-list-query";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/types";

describe("task_list_counters rpc", () => {
  it("maps the jsonb and fills missing statuses / priorities with 0", () => {
    const r = countersFromRpc({ status: { "To Do": 3 }, priority: { High: 2 }, total: 10, mine: 4, overdue: 1 });
    expect(r.sidebar.status["To Do"]).toBe(3);
    expect(Object.keys(r.sidebar.status)).toEqual(TASK_STATUSES);
    expect(Object.keys(r.sidebar.priority)).toEqual(TASK_PRIORITIES);
    expect(r.sidebar.priority.Low).toBe(0);
    expect(r.header).toEqual({ total: 10, mine: 4, overdue: 1 });
  });

  it("fetches sidebar and header in a single rpc call", async () => {
    rpc.mockResolvedValueOnce({ data: { status: {}, priority: {}, total: 5, mine: 1, overdue: 0 }, error: null });
    const r = await fetchTaskCounters("team_tasks", { userId: "u1", canSeeAll: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("task_list_counters", expect.objectContaining({ p_tab: "team_tasks", p_user: "u1" }));
    expect(r.header.total).toBe(5);
  });
});

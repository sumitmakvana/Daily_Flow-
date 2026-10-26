import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TASK = "22222222-2222-4222-8222-222222222222";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const ASSIGNEE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STARTED = "2026-03-10 10:00:00+00";

const calls: Array<{ sql: string; params: unknown[] }> = [];
let task = {
  status: "In Progress",
  started_at: null as string | null,
  system_hours: 2,
  assigned_to: ASSIGNEE,
};

const client = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    calls.push({ sql: s, params });
    if (/^INSERT INTO public\.task_eod_submissions/.test(s))
      return { rows: [{ id: "e1", task_id: params[0] }] };
    if (/SELECT COALESCE\(SUM/.test(s)) return { rows: [{ sum: "3" }] };
    if (/^SELECT status::text AS status FROM public\.tasks/.test(s))
      return { rows: [{ status: task.status }] };
    if (/FROM public\.tasks WHERE id = \$1 FOR UPDATE/.test(s)) {
      return {
        rows: [
          {
            started_at: task.started_at,
            system_hours: task.system_hours,
            assigned_to: task.assigned_to,
          },
        ],
      };
    }
    return { rows: [] };
  }),
};

vi.mock("@/integrations/postgres/query.server", () => ({
  withUser: async (_u: string, fn: (c: typeof client) => Promise<unknown>) => fn(client),
}));
vi.mock("@/lib/task-push.server", () => ({ pushTaskProgress: vi.fn() }));
const { bankTimer } = vi.hoisted(() => ({ bankTimer: vi.fn(async (..._a: unknown[]) => 1.5) }));
vi.mock("@/lib/task-timer.server", () => ({ bankTimer }));

import { upsertTaskEodFn } from "@/services/task-eod.functions";

// The handler skips the task update in "test" mode, so run it in "development".
const env = import.meta.env as Record<string, unknown>;
const originalMode = env.MODE;
beforeAll(() => {
  env.MODE = "development";
});
afterAll(() => {
  env.MODE = originalMode;
});

const submit = (progressStatus: "done" | "in_progress" | "blocked") =>
  upsertTaskEodFn({ data: { taskId: TASK, progressStatus, actualHours: 3, note: null } } as never);
const update = () => calls.find((c) => /^UPDATE public\.tasks/.test(c.sql));

describe("EOD check-in and the timer", () => {
  beforeEach(() => {
    calls.length = 0;
    bankTimer.mockClear();
    task = { status: "In Progress", started_at: STARTED, system_hours: 2, assigned_to: ASSIGNEE };
    (globalThis as unknown as { __test_user_id: string }).__test_user_id = ACTOR;
  });

  it("'in progress' banks the running segment once and restarts the timer from now", async () => {
    await submit("in_progress");

    expect(bankTimer).toHaveBeenCalledTimes(1);
    const u = update();
    // 2h already banked + the 1.5h segment just banked
    expect(u?.params[6]).toBe(3.5);
    // The old code kept started_at while ALSO adding the elapsed hours, so the same stretch
    // was counted again on the next pause. The timer must restart from now instead.
    expect(u?.sql).toMatch(
      /started_at = CASE WHEN \$1::text = 'In Progress' THEN now\(\) ELSE NULL END/,
    );
    expect(u?.sql).not.toMatch(/COALESCE\(started_at/);
    expect(u?.sql).toMatch(/system_hours = \$7/);
  });

  it("credits the worklog to the assignee, not the person submitting", async () => {
    await submit("in_progress");
    expect(bankTimer).toHaveBeenCalledWith(client, {
      taskId: TASK,
      userId: ASSIGNEE,
      startedAt: STARTED,
    });
  });

  it("'done' banks the segment and stops the timer", async () => {
    await submit("done");
    expect(bankTimer).toHaveBeenCalledTimes(1);
    const u = update();
    expect(u?.params[0]).toBe("Completed");
    expect(u?.params[6]).toBe(3.5);
    expect(u?.sql).toMatch(
      /started_at = CASE WHEN \$1::text = 'In Progress' THEN now\(\) ELSE NULL END/,
    );
  });

  it("a paused task banks nothing and keeps its hours", async () => {
    task.started_at = null;
    await submit("in_progress");
    expect(bankTimer).not.toHaveBeenCalled();
    expect(update()?.params[6]).toBe(2);
  });

  it("the EOD total (logged hours) is still the sum of submissions, independent of the timer", async () => {
    await submit("in_progress");
    expect(update()?.params[3]).toBe(3); // actual_hours = SUM(task_eod_submissions)
  });

  it("a task in review: records hours only, never touches status or the timer", async () => {
    task.status = "In Review";
    await submit("done");

    expect(bankTimer).not.toHaveBeenCalled();
    const updates = calls.filter((c) => /^UPDATE public\.tasks/.test(c.sql));
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toMatch(
      /^UPDATE public\.tasks SET actual_hours = \$1, updated_by = \$2 WHERE id = \$3$/,
    );
    expect(updates[0].sql).not.toMatch(/status|started_at|system_hours/);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "../helpers/fake-pg";

const db = new FakeDb();

vi.mock("@/integrations/postgres/query.server", () => ({
  withUser: (userId: string, fn: (c: unknown) => Promise<unknown>) => db.withUser(userId, fn as never),
}));
vi.mock("@/integrations/postgres/client.server", () => ({ getPool: () => db.pool() }));
vi.mock("@/lib/task-push.server", () => ({ pushTaskProgress: vi.fn() }));

import { tasksService } from "@/services/tasks";
import { carryForwardService } from "@/services/carry-forward";
import { startTaskForUser } from "@/lib/task-start.server";
import { elapsedHours, allocateAcrossDays } from "@/lib/task-timer.server";
import type { Task } from "@/lib/types";

const U = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const NOW = new Date("2026-03-10T12:00:00.000Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600000).toISOString();
const add = (t: Parameters<FakeDb["addTask"]>[0]) => db.addTask({ assigned_to: U, ...t });
const asTask = (id: string) => ({ ...db.get(id) }) as unknown as Task;

// updateTaskFn reads the current row only outside the "test" mode, so run these in "development".
const env = import.meta.env as Record<string, unknown>;
const originalMode = env.MODE;

beforeAll(() => {
  env.MODE = "development";
});
afterAll(() => {
  env.MODE = originalMode;
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  (globalThis as Record<string, unknown>).__test_user_id = U;
  db.tasks.clear();
  db.worklogs.length = 0;
  db.history.length = 0;
  db.carryEvents.length = 0;
  db.profileActive = true;
});
afterEach(() => vi.useRealTimers());

describe("pure helpers", () => {
  it("caps a session at 8h and never goes negative", () => {
    expect(elapsedHours(ago(2), NOW.getTime())).toBe(2);
    expect(elapsedHours(ago(30), NOW.getTime())).toBe(8);
    expect(elapsedHours(ago(-1), NOW.getTime())).toBe(0);
  });

  it("splits hours across days and always sums to the total", () => {
    const parts = allocateAcrossDays(
      [
        { work_date: "2026-03-09", hrs: 1 },
        { work_date: "2026-03-10", hrs: 2 },
      ],
      1.99,
    );
    expect(parts.map((p) => p.work_date)).toEqual(["2026-03-09", "2026-03-10"]);
    expect(Math.round(parts.reduce((a, p) => a + p.hours, 0) * 100) / 100).toBe(1.99);
    expect(allocateAcrossDays([{ work_date: "d", hrs: 0 }], 1)).toEqual([]);
  });
});

describe("Pause Timer", () => {
  it("stops the timer, banks elapsed time once, and keeps the task In Progress", async () => {
    add({ id: A, status: "In Progress", started_at: ago(1.5), system_hours: 2 });

    await tasksService.pauseTimer(asTask(A), U);

    const t = db.get(A);
    expect(t.started_at).toBeNull();
    expect(t.status).toBe("In Progress");
    expect(t.system_hours).toBe(3.5);
    expect(db.logsFor(A)).toHaveLength(1);
    expect(db.logsFor(A)[0]).toMatchObject({ system_hours: 1.5, work_date: "2026-03-10", user_id: U });
  });

  it("a second pause is a no-op (no duplicate log, no extra hours)", async () => {
    add({ id: A, status: "In Progress", started_at: ago(1), system_hours: 0 });
    await tasksService.pauseTimer(asTask(A), U);
    await tasksService.pauseTimer(asTask(A), U);

    expect(db.get(A).system_hours).toBe(1);
    expect(db.logsFor(A)).toHaveLength(1);
  });

  it("two simultaneous pause requests bank the time exactly once (row lock)", async () => {
    add({ id: A, status: "In Progress", started_at: ago(2), system_hours: 1 });
    const stale = asTask(A); // both requests were issued from the same stale snapshot

    await Promise.all([tasksService.pauseTimer(stale, U), tasksService.pauseTimer(stale, U)]);

    expect(db.logsFor(A)).toHaveLength(1);
    expect(db.get(A).system_hours).toBe(3);
    expect(db.loggedTotal(A)).toBe(2);
    expect(db.get(A).status).toBe("In Progress");
  });

  it("a session that crosses midnight is split onto the correct work dates", async () => {
    vi.setSystemTime(new Date("2026-03-11T01:00:00.000Z"));
    add({ id: A, status: "In Progress", started_at: "2026-03-10T23:00:00.000Z" });

    await tasksService.pauseTimer(asTask(A), U);

    expect(db.logsFor(A).map((w) => [w.work_date, w.system_hours])).toEqual([
      ["2026-03-10", 1],
      ["2026-03-11", 1],
    ]);
    expect(db.get(A).system_hours).toBe(2);
    expect(db.loggedTotal(A)).toBe(2);
  });
});

describe("Resume Timer", () => {
  it("starts a fresh session and never touches previously banked time", async () => {
    add({ id: A, status: "In Progress", started_at: ago(1), system_hours: 0 });
    await tasksService.pauseTimer(asTask(A), U);
    const firstLog = { ...db.logsFor(A)[0] };

    await tasksService.resumeTimer(asTask(A), U);
    expect(db.get(A).started_at).not.toBeNull();
    expect(db.get(A).status).toBe("In Progress");
    expect(db.get(A).system_hours).toBe(1); // unchanged by resume
    expect(db.logsFor(A)).toEqual([firstLog]);

    vi.setSystemTime(new Date(NOW.getTime() + 0.5 * 3600000));
    await tasksService.pauseTimer(asTask(A), U);
    expect(db.get(A).system_hours).toBe(1.5);
    expect(db.logsFor(A)).toHaveLength(2);
    expect(db.loggedTotal(A)).toBe(1.5);
  });

  it("a duplicate Resume keeps the original session start (no lost time)", async () => {
    add({ id: A, status: "In Progress", started_at: null, system_hours: 1 });
    await tasksService.resumeTimer(asTask(A), U);
    const firstStart = db.get(A).started_at;

    vi.setSystemTime(new Date(NOW.getTime() + 20 * 60000));
    await tasksService.resumeTimer(asTask(A), U); // second click / retry

    expect(db.get(A).started_at).toBe(firstStart);
    expect(db.logsFor(A)).toHaveLength(0);
  });
});

describe("Carry Forward → Tomorrow", () => {
  it("banks the running time, keeps In Progress, and moves to the next working day", async () => {
    add({
      id: A,
      status: "In Progress",
      started_at: ago(2),
      system_hours: 1,
      due_date: "2026-03-10",
      task_name: "keep me",
    });

    await carryForwardService.carryWithTimer(asTask(A));

    const t = db.get(A);
    expect(t.status).toBe("In Progress");
    expect(t.started_at).toBeNull();
    expect(t.system_hours).toBe(3);
    expect(t.task_name).toBe("keep me");
    expect(t.due_date).not.toBe("2026-03-10");
    expect(t.due_date! > "2026-03-10").toBe(true);
    expect(db.logsFor(A)).toHaveLength(1);
    expect(db.carryEvents).toHaveLength(1);
    expect(t.carry_forward_count).toBe(1);
  });

  it("a duplicate / concurrent carry banks once and is rejected as stale", async () => {
    add({ id: A, status: "In Progress", started_at: ago(2), system_hours: 0 });
    const stale = asTask(A);

    const results = await Promise.allSettled([
      carryForwardService.carryWithTimer(stale),
      carryForwardService.carryWithTimer(stale),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(db.logsFor(A)).toHaveLength(1);
    expect(db.get(A).system_hours).toBe(2);
    expect(db.carryEvents).toHaveLength(1);
  });

  it("carrying a paused In Progress task moves it without logging anything", async () => {
    add({ id: A, status: "In Progress", started_at: null, system_hours: 4 });
    await carryForwardService.carryWithTimer(asTask(A));

    expect(db.logsFor(A)).toHaveLength(0);
    expect(db.get(A).system_hours).toBe(4);
    expect(db.get(A).status).toBe("In Progress");
  });

  it("refuses tasks that are not In Progress", async () => {
    add({ id: A, status: "To Do" });
    await expect(carryForwardService.carryWithTimer(asTask(A))).rejects.toThrow(/In Progress/);
    expect(db.carryEvents).toHaveLength(0);
  });

  it("a carried task can be resumed the next day and adds to the same total", async () => {
    add({ id: A, status: "In Progress", started_at: ago(2), system_hours: 1 });
    await carryForwardService.carryWithTimer(asTask(A));

    vi.setSystemTime(new Date(NOW.getTime() + 24 * 3600000));
    await tasksService.resumeTimer(asTask(A), U);
    vi.setSystemTime(new Date(NOW.getTime() + 25 * 3600000));
    await tasksService.pauseTimer(asTask(A), U);

    expect(db.get(A).system_hours).toBe(4); // 1 + 2 (day 1) + 1 (day 2)
    expect(db.logsFor(A)).toHaveLength(2);
    expect(db.loggedTotal(A)).toBe(3);
  });
});

describe("Switching between tasks", () => {
  it("starting a task stops the running one but keeps its status; paused tasks are untouched", async () => {
    add({ id: A, status: "In Progress", started_at: ago(1), system_hours: 0 });
    add({ id: B, status: "In Progress", started_at: null, system_hours: 3 }); // paused / carried
    add({ id: C, status: "To Do" });
    const bBefore = { ...db.get(B) };

    await tasksService.resumeTimer(asTask(C), U);

    expect(db.get(C)).toMatchObject({ status: "In Progress" });
    expect(db.get(C).started_at).not.toBeNull();
    expect(db.get(A)).toMatchObject({ status: "In Progress", started_at: null, system_hours: 1 });
    expect(db.logsFor(A)).toHaveLength(1);
    expect(db.get(B)).toEqual(bBefore); // not changed to To Do, version not bumped, no log
    expect(db.history.find((h) => h.task_id === A)).toMatchObject({
      old_status: "In Progress",
      new_status: "In Progress",
    });
  });

  it("only one timer runs per user after any number of starts", async () => {
    add({ id: A, status: "To Do" });
    add({ id: B, status: "To Do" });
    await tasksService.resumeTimer(asTask(A), U);
    vi.setSystemTime(new Date(NOW.getTime() + 3600000));
    await tasksService.resumeTimer(asTask(B), U);

    const running = [...db.tasks.values()].filter((t) => t.started_at);
    expect(running.map((t) => t.id)).toEqual([B]);
    expect(db.get(A).system_hours).toBe(1);
  });

  it("switchActiveTask pauses (not 'To Do') the old task and starts the new one", async () => {
    add({ id: A, status: "In Progress", started_at: ago(1) });
    add({ id: B, status: "To Do" });

    const { stoppedTask, startedTask } = await tasksService.switchActiveTask(asTask(A), asTask(B), U);

    expect(stoppedTask.status).toBe("In Progress");
    expect(stoppedTask.started_at).toBeNull();
    expect(startedTask.status).toBe("In Progress");
    expect(startedTask.started_at).not.toBeNull();
  });

  it("push/email start: a paused In Progress task is resumable and does not disturb other paused tasks", async () => {
    add({ id: A, status: "In Progress", started_at: ago(1), system_hours: 0 });
    add({ id: B, status: "In Progress", started_at: null, system_hours: 2 });

    const r = await startTaskForUser(U, B);

    expect(r.result).toBe("started");
    expect(db.get(B).started_at).not.toBeNull();
    expect(db.get(B).system_hours).toBe(2);
    expect(db.get(A)).toMatchObject({ status: "In Progress", started_at: null, system_hours: 1 });
  });

  it("push start of an already-running task is idempotent", async () => {
    add({ id: A, status: "In Progress", started_at: ago(1) });
    expect((await startTaskForUser(U, A)).result).toBe("already_in_progress");
    expect(db.logsFor(A)).toHaveLength(0);
  });

  it("two simultaneous push starts of the same task start it once", async () => {
    add({ id: A, status: "To Do" });
    const results = await Promise.all([startTaskForUser(U, A), startTaskForUser(U, A)]);
    expect(results.map((r) => r.result).sort()).toEqual(["already_in_progress", "started"]);
  });
});

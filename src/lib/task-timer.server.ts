/**
 * Shared, server-only timer primitives. Every path that stops a running timer
 * (Pause, Carry Forward, switching tasks, push/email start) goes through here so that
 * elapsed time is banked exactly once.
 *
 * Timer model:
 *   - A task's timer is running  <=>  tasks.started_at IS NOT NULL.
 *   - tasks.status is independent: pausing never changes it (a paused task stays In Progress).
 *   - Banked time lives in tasks.system_hours (total) and task_worklogs (one row per day segment).
 *
 * Callers MUST hold a row lock on the task (SELECT ... FOR UPDATE) inside the same
 * transaction before reading started_at; the lock is what makes "bank once" safe against
 * concurrent or double-submitted requests.
 */
import type { PoolClient } from "pg";

/** Longest single timer session that is credited. */
export const MAX_SESSION_HOURS = 8;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Elapsed hours of a session started at `startedAt`, capped and rounded to 2 decimals. */
export function elapsedHours(startedAt: string | Date, now: number = Date.now()): number {
  const ms = now - new Date(startedAt).getTime();
  return Math.min(MAX_SESSION_HOURS, Math.max(0, round2(ms / 3600000)));
}

/**
 * Split `total` hours across the per-day raw segments proportionally so the parts sum to
 * `total` exactly (the last non-empty part absorbs rounding). Pure, exported for tests.
 */
export function allocateAcrossDays(
  segments: ReadonlyArray<{ work_date: string; hrs: number }>,
  total: number,
): Array<{ work_date: string; hours: number }> {
  const live = segments.filter((s) => s.hrs > 0);
  const raw = live.reduce((a, s) => a + s.hrs, 0);
  if (total <= 0 || raw <= 0 || live.length === 0) return [];
  const out: Array<{ work_date: string; hours: number }> = [];
  let used = 0;
  live.forEach((s, i) => {
    const hours = i === live.length - 1 ? round2(total - used) : round2((s.hrs / raw) * total);
    used = round2(used + hours);
    if (hours > 0) out.push({ work_date: s.work_date, hours });
  });
  return out;
}

/**
 * Write the worklog rows for one finished session and return the hours credited.
 * A session that crosses midnight is split so each day's hours land on the right work_date.
 * Never throws for worklog failures (the task total is still updated by the caller),
 * matching the previous behaviour.
 */
export async function bankTimer(
  client: PoolClient,
  args: { taskId: string; userId: string; startedAt: string },
): Promise<number> {
  const elapsed = elapsedHours(args.startedAt);
  if (elapsed <= 0) return 0;

  await client.query("SAVEPOINT bank_timer");
  try {
    const seg = await client.query<{ work_date: string; hrs: string | number }>(
      `SELECT d::date::text AS work_date,
              EXTRACT(EPOCH FROM (LEAST(NOW(), d + INTERVAL '1 day') - GREATEST($1::timestamptz, d))) / 3600.0 AS hrs
         FROM generate_series($1::timestamptz::date, NOW()::date, INTERVAL '1 day') AS d`,
      [args.startedAt],
    );
    let parts = allocateAcrossDays(
      seg.rows.map((r) => ({ work_date: r.work_date, hrs: Number(r.hrs) })),
      elapsed,
    );
    if (parts.length === 0) {
      const today = await client.query<{ d: string }>("SELECT CURRENT_DATE::text AS d");
      parts = [{ work_date: today.rows[0].d, hours: elapsed }];
    }
    for (const p of parts) {
      await client.query(
        `INSERT INTO public.task_worklogs (task_id, user_id, work_date, system_hours, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [args.taskId, args.userId, p.work_date, p.hours, args.startedAt],
      );
    }
    await client.query("RELEASE SAVEPOINT bank_timer");
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT bank_timer");
    console.warn("[task_worklogs] insert failed:", (e as Error).message);
  }
  return elapsed;
}

/**
 * Single active timer per user: stop every OTHER running timer of `userId`.
 * Only the timer is stopped; the other tasks keep their status (e.g. In Progress).
 * A task without a running timer (paused / carried forward) is never touched.
 */
export async function pauseOtherRunningTimers(
  client: PoolClient,
  args: { userId: string; actorId: string; exceptTaskId?: string; comment: string },
): Promise<string[]> {
  const others = await client.query<{
    id: string;
    started_at: string;
    system_hours: number | null;
    status: string;
  }>(
    `SELECT id, started_at::text AS started_at, system_hours, status::text AS status
       FROM public.tasks
      WHERE assigned_to = $1
        AND started_at IS NOT NULL
        AND status <> 'Completed'
        AND ($2::uuid IS NULL OR id <> $2::uuid)
      FOR UPDATE`,
    [args.userId, args.exceptTaskId ?? null],
  );

  for (const other of others.rows) {
    const elapsed = await bankTimer(client, {
      taskId: other.id,
      userId: args.actorId,
      startedAt: other.started_at,
    });
    await client.query(
      `UPDATE public.tasks
          SET started_at = NULL, system_hours = $1,
              version = version + 1, updated_at = NOW(), updated_by = $2
        WHERE id = $3`,
      [Number(other.system_hours ?? 0) + elapsed, args.actorId, other.id],
    );
    await client.query("SAVEPOINT history_pause");
    try {
      await client.query(
        `INSERT INTO public.task_history (task_id, old_status, new_status, updated_by, comment)
         VALUES ($1, $2, $2, $3, $4)`,
        [other.id, other.status, args.actorId, args.comment],
      );
      await client.query("RELEASE SAVEPOINT history_pause");
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT history_pause");
      console.warn("[tasks] history insert failed on timer pause:", (e as Error).message);
    }
  }
  return others.rows.map((r) => r.id);
}

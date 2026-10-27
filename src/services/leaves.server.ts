import { getPool } from "@/integrations/postgres/client.server";
import { getTodayDateStr } from "@/lib/task-date-utils";

let tableEnsured = false;
export async function ensureLeavesTableAdmin() {
  if (tableEnsured) return;
  try {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.leaves (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        leave_type text NOT NULL DEFAULT 'planned',
        start_date date NOT NULL,
        end_date date NOT NULL,
        days_count numeric(4,1) DEFAULT 1.0,
        reason text DEFAULT '',
        status text NOT NULL DEFAULT 'approved',
        handover_note text,
        request_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
        reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
        reviewed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.leaves ADD COLUMN IF NOT EXISTS request_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
      ALTER TABLE public.leaves ALTER COLUMN reason DROP NOT NULL;
      ALTER TABLE public.leaves ALTER COLUMN leave_type SET DEFAULT 'planned';
      UPDATE public.leaves SET leave_type = 'planned' WHERE leave_type = 'casual';
      CREATE INDEX IF NOT EXISTS idx_leaves_dates ON public.leaves(start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_leaves_user ON public.leaves(user_id);
    `);
    tableEnsured = true;
  } catch (err) {
    console.warn("[leaves] ensure table check:", (err as Error).message);
  }
}

export async function autoPauseTasksForUserOnLeave(pool: any, userId: string, leaveType?: string) {
  try {
    const leaveReason = leaveType ? `On Leave (${leaveType.toUpperCase()})` : "On Leave";
    // Find active tasks for this user (status = 'In Progress' or started_at IS NOT NULL)
    const activeRes = await pool.query(
      `SELECT id, started_at::text, system_hours FROM public.tasks 
       WHERE assigned_to = $1 AND (status = 'In Progress' OR started_at IS NOT NULL)`,
      [userId]
    );

    for (const t of activeRes.rows) {
      let sysHours = Number(t.system_hours || 0);
      if (t.started_at) {
        const startTs = new Date(t.started_at).getTime();
        const elapsed = Math.min(8.0, Math.max(0, Math.round(((Date.now() - startTs) / 3600000) * 100) / 100));
        sysHours += elapsed;
      }

      await pool.query(
        `UPDATE public.tasks 
         SET status = 'On Hold', hold_reason = $1, started_at = NULL, system_hours = $2, updated_at = now()
         WHERE id = $3`,
        [leaveReason, sysHours, t.id]
      );
    }
  } catch (err) {
    console.warn("[leaves] autoPauseTasksForUserOnLeave error:", err);
  }
}

let lastPromoteRunAt = 0;

/**
 * Converts every tentative leave whose start date has arrived (or passed) into an approved Planned Leave.
 * Idempotent and safe to call from several places / instances: the UPDATE only matches rows that are still
 * tentative, so each leave is promoted (and its tasks paused / notifications sent) exactly once.
 * Anything edited to a later date before then simply stays tentative until that new date.
 */
export async function promoteDueTentativeLeaves(todayStr?: string, opts: { throttle?: boolean } = {}) {
  if (opts.throttle && Date.now() - lastPromoteRunAt < 60_000) return 0;
  lastPromoteRunAt = Date.now();
  try {
    await ensureLeavesTableAdmin();
    const pool = getPool();
    const today = todayStr || getTodayDateStr("Asia/Kolkata");
    const res = await pool.query<{
      id: string;
      user_id: string;
      start_date: string;
      end_date: string;
      reason: string | null;
      request_to: string | null;
    }>(
      `UPDATE public.leaves
       SET leave_type = 'planned', status = 'approved', updated_at = now()
       WHERE status = 'tentative' AND start_date <= $1::date
       RETURNING id, user_id, start_date::text, end_date::text, reason, request_to`,
      [today]
    );

    for (const l of res.rows) {
      // Existing auto-pause logic, only when the leave covers today
      if (l.start_date <= today && l.end_date >= today) {
        await autoPauseTasksForUserOnLeave(pool, l.user_id, "planned");
      }
      try {
        const prof = await pool.query<{ display_name: string; manager_id: string | null }>(
          `SELECT display_name, manager_id FROM public.profiles WHERE id = $1`,
          [l.user_id]
        );
        const empName = prof.rows[0]?.display_name || "Team member";
        const range = `${l.start_date} to ${l.end_date}`;
        await pool.query(
          `INSERT INTO public.notifications (user_id, type, title, body) VALUES ($1, $2, $3, $4)`,
          [
            l.user_id,
            "leave_status_updated",
            "Tentative leave confirmed as Planned Leave",
            `Your tentative leave for ${range} was not changed or cancelled, so it is now an approved Planned Leave.`,
          ]
        );
        const recipientId =
          l.request_to ||
          prof.rows[0]?.manager_id ||
          (await pool.query<{ user_id: string }>(`SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1`))
            .rows[0]?.user_id;
        if (recipientId && recipientId !== l.user_id) {
          await pool.query(
            `INSERT INTO public.notifications (user_id, type, title, body) VALUES ($1, $2, $3, $4)`,
            [
              recipientId,
              "leave_applied",
              `🌴 Leave Notice: ${empName}`,
              `${empName}'s tentative leave from ${range} is now a confirmed PLANNED leave. Plan tasks accordingly.`,
            ]
          );
        }
      } catch (notifErr) {
        console.warn("[leaves] tentative promotion notification failed:", (notifErr as Error).message);
      }
    }
    if (res.rows.length > 0) console.log(`[leaves] promoted ${res.rows.length} tentative leave(s) to planned`);
    return res.rows.length;
  } catch (err) {
    console.warn("[leaves] promoteDueTentativeLeaves error:", (err as Error).message);
    return 0;
  }
}


/** Company holidays (same `holidays` table the leave dialog uses), for working-day calculations. */
export async function fetchCompanyHolidays(): Promise<Array<{ calendar_date: string; label: string }>> {
  try {
    const res = await getPool().query<{ calendar_date: string; label: string }>(
      "SELECT calendar_date::text AS calendar_date, label FROM public.holidays"
    );
    return res.rows;
  } catch {
    return [];
  }
}

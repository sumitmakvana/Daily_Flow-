import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import type { ReviewQueueItem } from "@/services/reviews";

/**
 * In Review workflow server functions. Permission, state, timer and hours rules all live in
 * the SQL functions (SECURITY DEFINER, keyed on auth.uid()):
 *   submit_task_for_review  banks the final timer segment, records the assignee's manual EOD
 *                           logged hours, opens the review cycle and notifies the reviewer
 *   log_review_hours        assignee enters/corrects today's hours while in review
 *   decide_task_review      approve (needs logged hours) / request changes (needs feedback)
 * so a direct RPC call gets exactly the same behaviour as these wrappers.
 */

/**
 * Each reviewer's own status for a cycle, in assignment order. For an In Review task that has no
 * open cycle yet (pre-workflow data) the assigned reviewers are listed as pending.
 * Expects the aliases `tr` (task_reviews, may be NULL) and `t` (tasks).
 */
const REVIEWERS_OF_CYCLE = `
  COALESCE(
    (SELECT json_agg(json_build_object(
              'reviewer_id', d.reviewer_id, 'decision', d.decision, 'decided_by', d.decided_by,
              'decided_at', d.decided_at, 'feedback', d.feedback)
            ORDER BY r.position NULLS LAST, d.created_at)
       FROM public.task_review_decisions d
       LEFT JOIN public.task_reviewers r ON r.task_id = d.task_id AND r.reviewer_id = d.reviewer_id
      WHERE d.review_id = tr.id),
    (SELECT json_agg(json_build_object(
              'reviewer_id', r.reviewer_id, 'decision', 'pending', 'decided_by', NULL,
              'decided_at', NULL, 'feedback', NULL) ORDER BY r.position, r.created_at)
       FROM public.task_reviewers r WHERE r.task_id = t.id AND tr.id IS NULL),
    '[]'::json)`;

const REVIEW_COLS = `tr.id, tr.task_id, tr.cycle_no, tr.submitted_by, tr.submitted_at, tr.reviewer_id,
                     tr.decision, tr.decided_by, tr.decided_at, tr.feedback,
                     tr.logged_hours_confirmed_at, tr.logged_hours_today::float8 AS logged_hours_today,
                     tr.logged_hours_total::float8 AS logged_hours_total,
                     tr.system_hours_total::float8 AS system_hours_total`;

const hoursSchema = z.number().min(0).max(24);

export const submitForReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; loggedHours?: number; note?: string }) =>
    z
      .object({
        taskId: z.string().uuid(),
        loggedHours: hoursSchema.optional(),
        note: z.string().max(10000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query(`SELECT * FROM public.submit_task_for_review($1, $2, $3)`, [
        data.taskId,
        data.loggedHours ?? null,
        data.note?.trim() || null,
      ]);
      return res.rows[0];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const logReviewHoursFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; hours: number; note?: string }) =>
    z
      .object({
        taskId: z.string().uuid(),
        hours: hoursSchema,
        note: z.string().max(10000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      const res = await client.query(`SELECT * FROM public.log_review_hours($1, $2, $3)`, [
        data.taskId,
        data.hours,
        data.note?.trim() || null,
      ]);
      return res.rows[0];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const decideReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      taskId: string;
      decision: "approved" | "changes_requested";
      feedback?: string;
      reviewerId?: string;
    }) =>
      z
        .object({
          taskId: z.string().uuid(),
          decision: z.enum(["approved", "changes_requested"]),
          feedback: z.string().max(5000).optional(),
          reviewerId: z.string().uuid().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      // reviewerId is only needed when a manager decides on behalf of a named reviewer; a
      // reviewer deciding for themselves leaves it out.
      const res = await client.query(`SELECT * FROM public.decide_task_review($1, $2, $3, $4)`, [
        data.taskId,
        data.decision,
        data.feedback ?? null,
        data.reviewerId ?? null,
      ]);
      return res.rows[0];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const listTaskReviewsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string }) => z.object({ taskId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${REVIEW_COLS}, ${REVIEWERS_OF_CYCLE} AS reviewers
           FROM public.task_reviews tr
           JOIN public.tasks t ON t.id = tr.task_id
          WHERE tr.task_id = $1 ORDER BY tr.cycle_no DESC`,
        [data.taskId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

/**
 * Tasks currently In Review. `mine` = the caller is the assigned reviewer; `all` = every task
 * in review, managers/admins only (enforced here, not just hidden in the UI).
 */
export const listReviewQueueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { scope: "mine" | "all" }) =>
    z.object({ scope: z.enum(["mine", "all"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      if (data.scope === "all") {
        const mgr = await client.query<{ ok: boolean }>(
          `SELECT public.is_manager_or_admin($1) AS ok`,
          [context.userId],
        );
        if (!mgr.rows[0]?.ok) throw new Error("Only managers and admins can view all reviews");
      }
      const res = await client.query<ReviewQueueItem>(
        `SELECT t.id, t.task_code, t.task_name, t.project_name, t.priority::text AS priority,
                t.due_date::text AS due_date, t.assigned_to, t.reviewer, t.status::text AS status,
                t.planned_hours::float8 AS planned_hours, t.actual_hours::float8 AS actual_hours,
                t.system_hours::float8 AS system_hours,
                tr.id AS review_id, tr.cycle_no, tr.submitted_by,
                tr.logged_hours_confirmed_at, tr.logged_hours_today::float8 AS logged_hours_today,
                COALESCE(tr.submitted_at, t.review_submitted_at, t.updated_at) AS submitted_at,
                ${REVIEWERS_OF_CYCLE} AS reviewers,
                (SELECT d.decision FROM public.task_review_decisions d
                  WHERE d.review_id = tr.id AND d.reviewer_id = $1) AS my_decision
           FROM public.tasks t
           LEFT JOIN public.task_reviews tr ON tr.task_id = t.id AND tr.decision = 'pending'
          WHERE t.status = 'In Review'
            AND ($2::boolean
                 -- "mine": any task where I am one of its reviewers, whatever my own status is
                 OR EXISTS (SELECT 1 FROM public.task_review_decisions d
                             WHERE d.review_id = tr.id AND d.reviewer_id = $1)
                 OR EXISTS (SELECT 1 FROM public.pending_review_assignments p
                             WHERE p.task_id = t.id AND p.reviewer_id = $1))
          ORDER BY (SELECT d.decision = 'pending' FROM public.task_review_decisions d
                     WHERE d.review_id = tr.id AND d.reviewer_id = $1) DESC NULLS LAST,
                   COALESCE(tr.submitted_at, t.review_submitted_at, t.updated_at) ASC`,
        [context.userId, data.scope === "all"],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

/** The reviewers assigned to a task, in order (task_reviewers is the single source of truth). */
export const listTaskReviewersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string }) => z.object({ taskId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT reviewer_id, position FROM public.task_reviewers
          WHERE task_id = $1 ORDER BY position, created_at`,
        [data.taskId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

/** Replace a task's reviewer list. Permissions and rules are enforced by set_task_reviewers. */
export const setTaskReviewersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; reviewerIds: string[] }) =>
    z
      .object({ taskId: z.string().uuid(), reviewerIds: z.array(z.string().uuid()).max(10) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(`SELECT * FROM public.set_task_reviewers($1, $2::uuid[])`, [
        data.taskId,
        data.reviewerIds,
      ]);
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

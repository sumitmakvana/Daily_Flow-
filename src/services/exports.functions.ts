import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

const KIND = [
  "task_audit",
  "user_activity",
  "carry_forward",
  "blockers",
  "workload",
  "sla_violations",
  "daily_ops",
] as const;

const FiltersSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  teamId: z.string().optional(),
  projectId: z.string().optional(),
  userId: z.string().optional(),
  status: z.string().optional(),
});

export const buildExportRowsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      kind: (typeof KIND)[number];
      filters: z.infer<typeof FiltersSchema>;
    }) =>
      z.object({ kind: z.enum(KIND), filters: FiltersSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const from = data.filters.from ?? "1970-01-01";
    const to = data.filters.to ?? new Date().toISOString().slice(0, 10);
    const result = await withUser(context.userId, async (client) => {
      switch (data.kind) {
        case "task_audit": {
          const r = await client.query(
            `SELECT created_at, task_id, old_status, new_status, updated_by, comment
               FROM public.task_history
               WHERE created_at >= $1 AND created_at <= ($2 || 'T23:59:59')::timestamptz
               ORDER BY created_at DESC`,
            [from, to],
          );
          return {
            columns: ["created_at", "task_id", "old_status", "new_status", "updated_by", "comment"],
            rows: r.rows,
          };
        }
        case "user_activity": {
          const r = await client.query(
            `SELECT rollup_date, user_id, status_updates_count, eod_submitted,
                    blocker_usage, notif_interactions
               FROM public.adoption_daily
               WHERE rollup_date >= $1 AND rollup_date <= $2`,
            [from, to],
          );
          return {
            columns: ["rollup_date", "user_id", "status_updates_count", "eod_submitted", "blocker_usage", "notif_interactions"],
            rows: r.rows,
          };
        }
        case "carry_forward": {
          const r = await client.query(
            `SELECT created_at, task_id, from_date, to_date, reason, created_by
               FROM public.carry_forward_events
               WHERE from_date >= $1 AND to_date <= $2
               ORDER BY created_at DESC`,
            [from, to],
          );
          return {
            columns: ["created_at", "task_id", "from_date", "to_date", "reason", "created_by"],
            rows: r.rows,
          };
        }
        case "blockers": {
          const params: unknown[] = [];
          let where = `status = 'Blocked'`;
          if (data.filters.userId) {
            params.push(data.filters.userId);
            where += ` AND assigned_to = $${params.length}`;
          }
          const r = await client.query(
            `SELECT task_code, task_name, assigned_to, status, blocker_reason, blocked_at, priority
               FROM public.tasks
               WHERE ${where}`,
            params,
          );
          return {
            columns: ["task_code", "task_name", "assigned_to", "priority", "blocked_at", "blocker_reason"],
            rows: r.rows,
          };
        }
        case "workload": {
          const r = await client.query(
            `SELECT snapshot_date, user_id, planned_hours, actual_hours,
                    active_count, delayed_count, blocked_count, completed_count
               FROM public.daily_workload_snapshot
               WHERE snapshot_date >= $1 AND snapshot_date <= $2`,
            [from, to],
          );
          return {
            columns: ["snapshot_date", "user_id", "planned_hours", "actual_hours", "active_count", "delayed_count", "blocked_count", "completed_count"],
            rows: r.rows,
          };
        }
        case "sla_violations": {
          const r = await client.query(
            `SELECT task_code, task_name, assigned_to, priority, status, sla_due_at, due_date
               FROM public.tasks
               WHERE sla_due_at IS NOT NULL
                 AND sla_due_at < now()
                 AND status <> 'Completed'`,
          );
          return {
            columns: ["task_code", "task_name", "assigned_to", "priority", "status", "sla_due_at", "due_date"],
            rows: r.rows,
          };
        }
        case "daily_ops": {
          const r = await client.query(
            `SELECT checkin_date, user_id, completed_count, pending_count,
                    blocker_count, remaining_hours, note
               FROM public.eod_checkins
               WHERE checkin_date >= $1 AND checkin_date <= $2`,
            [from, to],
          );
          return {
            columns: ["checkin_date", "user_id", "completed_count", "pending_count", "blocker_count", "remaining_hours", "note"],
            rows: r.rows,
          };
        }
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
  });

export const recordExportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      kind: (typeof KIND)[number];
      filters: Record<string, unknown>;
      rowCount: number;
    }) =>
      z
        .object({
          kind: z.enum(KIND),
          filters: z.record(z.string(), z.unknown()),
          rowCount: z.number().int().nonnegative(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    try {
      await withUser(context.userId, async (client) => {
        await client.query(
          `SELECT public.record_export($1, $2::jsonb, $3)`,
          [data.kind, JSON.stringify(data.filters), data.rowCount],
        );
      });
    } catch (e) {
      // Match prior behavior: surface but never block download.
      console.warn("[exports.record] audit insert failed:", e);
    }
    return { ok: true };
  });

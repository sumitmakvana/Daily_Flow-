import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getPool } from "@/integrations/postgres/client.server";
import { selectAsUser, withUser } from "@/integrations/postgres/query.server";
import type { Leave } from "@/lib/types";

let tableEnsured = false;
async function ensureLeavesTableAdmin() {
  if (tableEnsured) return;
  try {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.leaves (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
        leave_type text NOT NULL DEFAULT 'casual',
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
      CREATE INDEX IF NOT EXISTS idx_leaves_dates ON public.leaves(start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_leaves_user ON public.leaves(user_id);
    `);
    tableEnsured = true;
  } catch (err) {
    console.warn("[leaves] ensure table check:", (err as Error).message);
  }
}

export const fetchLeavesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((d?: { startDate?: string; endDate?: string; status?: string; userId?: string }) =>
    z
      .object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        status: z.string().optional(),
        userId: z.string().optional(),
      })
      .optional()
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    await ensureLeavesTableAdmin();
    const startDate = data?.startDate;
    const endDate = data?.endDate;
    const status = data?.status;
    const filterUserId = data?.userId;

    let query = `
      SELECT 
        l.id,
        l.user_id,
        l.leave_type,
        l.start_date::text,
        l.end_date::text,
        l.days_count::float as days_count,
        COALESCE(l.reason, '') as reason,
        l.status,
        l.handover_note,
        l.request_to,
        l.reviewed_by,
        l.reviewed_at::text,
        l.created_at::text,
        p.display_name as user_name,
        p.avatar_url as user_avatar,
        req_p.display_name as request_to_name,
        rp.display_name as reviewer_name
      FROM public.leaves l
      LEFT JOIN public.profiles p ON p.id = l.user_id
      LEFT JOIN public.profiles req_p ON req_p.id = l.request_to
      LEFT JOIN public.profiles rp ON rp.id = l.reviewed_by
    `;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (startDate && endDate) {
      params.push(startDate, endDate);
      conditions.push(`(l.start_date <= $${params.length} AND l.end_date >= $${params.length - 1})`);
    }

    if (status && status !== "__all") {
      params.push(status);
      conditions.push(`l.status = $${params.length}`);
    }

    if (filterUserId) {
      params.push(filterUserId);
      conditions.push(`l.user_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(" AND ");
    }

    query += ` ORDER BY l.created_at DESC, l.start_date DESC`;

    const pool = getPool();
    const res = await pool.query<Leave>(query, params);
    return res.rows;
  });

export const createLeaveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    userId?: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    daysCount?: number;
    reason?: string;
    requestTo?: string | null;
    status?: string;
    handoverNote?: string;
  }) =>

    z
      .object({
        userId: z.string().uuid().optional(),
        leaveType: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        daysCount: z.number().optional(),
        reason: z.string().optional().default(""),
        requestTo: z.string().uuid().optional().nullable(),
        status: z.string().optional(),
        handoverNote: z.string().optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    await ensureLeavesTableAdmin();
    const targetUserId = data.userId || context.userId;
    const days = data.daysCount ?? 1.0;
    const initialStatus = data.status || "approved";

    const pool = getPool();
    const insertRes = await pool.query<Leave>(
      `INSERT INTO public.leaves (user_id, leave_type, start_date, end_date, days_count, reason, status, handover_note, request_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, user_id, leave_type, start_date::text, end_date::text, days_count::float as days_count, reason, status, request_to, created_at::text`,
      [
        targetUserId,
        data.leaveType,
        data.startDate,
        data.endDate,
        days,
        data.reason || "",
        initialStatus,
        data.handoverNote || null,
        data.requestTo || null,
      ]
    );

    const created = insertRes.rows[0];

    // Notify selected manager/recipient (targeted single notification)
    try {
      const userProfile = await pool.query<{ display_name: string; manager_id: string | null }>(
        `SELECT display_name, manager_id FROM public.profiles WHERE id = $1`,
        [targetUserId]
      );
      const empName = userProfile.rows[0]?.display_name || "Team member";
      const managerId = userProfile.rows[0]?.manager_id;

      const recipientIds = new Set<string>();
      if (data.requestTo) {
        recipientIds.add(data.requestTo);
      } else if (managerId) {
        recipientIds.add(managerId);
      } else {
        // Fallback to first active admin
        const adminRes = await pool.query<{ user_id: string }>(
          `SELECT user_id FROM public.user_roles WHERE role = 'admin' LIMIT 1`
        );
        if (adminRes.rows[0]?.user_id) recipientIds.add(adminRes.rows[0].user_id);
      }
      recipientIds.delete(context.userId); // Don't notify self

      const isWfh = data.leaveType === "wfh";
      const leaveLabel = isWfh ? "WFH" : data.leaveType.toUpperCase();
      const reasonSuffix = data.reason ? ` (${data.reason})` : "";

      for (const mId of recipientIds) {
        await pool.query(
          `INSERT INTO public.notifications (user_id, type, title, body)
           VALUES ($1, $2, $3, $4)`,
          [
            mId,
            "leave_applied",
            isWfh ? `🏠 WFH Notice: ${empName}` : `🌴 Leave Notice: ${empName}`,
            `${empName} marked ${leaveLabel} from ${data.startDate} to ${data.endDate}${reasonSuffix}. Plan tasks accordingly.`,
          ]
        );
      }
    } catch (notifErr) {
      console.warn("[leaves] notification dispatch failed:", (notifErr as Error).message);
    }

    return created;
  });

export const updateLeaveStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    id: string;
    status: string;
  }) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["approved", "rejected", "cancelled", "pending"]),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    await ensureLeavesTableAdmin();
    const pool = getPool();
    const res = await pool.query<Leave>(
      `UPDATE public.leaves
       SET status = $1, reviewed_by = $2, reviewed_at = now(), updated_at = now()
       WHERE id = $3
       RETURNING id, user_id, leave_type, start_date::text, end_date::text, status`,
      [data.status, context.userId, data.id]
    );

    const updated = res.rows[0];
    if (updated) {
      // Notify employee of status change
      try {
        await pool.query(
          `INSERT INTO public.notifications (user_id, type, title, body)
           VALUES ($1, $2, $3, $4)`,
          [
            updated.user_id,
            "leave_status_updated",
            `Leave request ${data.status}`,
            `Your ${updated.leave_type} request for ${updated.start_date} to ${updated.end_date} is now ${data.status}.`,
          ]
        );
      } catch (err) {
        console.warn("[leaves] status update notif failed:", err);
      }
    }

    return updated;
  });

export const updateLeaveDetailsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    id: string;
    leaveType?: string;
    startDate?: string;
    endDate?: string;
    daysCount?: number;
    reason?: string;
    requestTo?: string | null;
    handoverNote?: string;
  }) =>
    z
      .object({
        id: z.string().uuid(),
        leaveType: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        daysCount: z.number().optional(),
        reason: z.string().optional(),
        requestTo: z.string().uuid().optional().nullable(),
        handoverNote: z.string().optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    await ensureLeavesTableAdmin();
    const pool = getPool();

    const existing = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM public.leaves WHERE id = $1`,
      [data.id]
    );
    if (existing.rows.length === 0) {
      throw new Error("Leave record not found");
    }

    const isOwner = existing.rows[0].user_id === context.userId;
    if (!isOwner) {
      throw new Error("Only the team member who created this leave request can edit it.");
    }


    const updates: string[] = [];
    const params: any[] = [data.id];

    if (data.leaveType !== undefined) {
      params.push(data.leaveType);
      updates.push(`leave_type = $${params.length}`);
    }
    if (data.startDate !== undefined) {
      params.push(data.startDate);
      updates.push(`start_date = $${params.length}`);
    }
    if (data.endDate !== undefined) {
      params.push(data.endDate);
      updates.push(`end_date = $${params.length}`);
    }
    if (data.daysCount !== undefined) {
      params.push(data.daysCount);
      updates.push(`days_count = $${params.length}`);
    }
    if (data.reason !== undefined) {
      params.push(data.reason);
      updates.push(`reason = $${params.length}`);
    }
    if (data.requestTo !== undefined) {
      params.push(data.requestTo);
      updates.push(`request_to = $${params.length}`);
    }
    if (data.handoverNote !== undefined) {
      params.push(data.handoverNote);
      updates.push(`handover_note = $${params.length}`);
    }

    updates.push(`updated_at = now()`);

    const query = `
      UPDATE public.leaves
      SET ${updates.join(", ")}
      WHERE id = $1
      RETURNING id, user_id, leave_type, start_date::text, end_date::text, days_count, reason, status, handover_note, request_to, created_at::text, updated_at::text
    `;

    const res = await pool.query<Leave>(query, params);
    return res.rows[0];
  });


export const deleteLeaveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { id: string; reason?: string }) =>
    z
      .object({
        id: z.string().uuid(),
        reason: z.string().optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    await ensureLeavesTableAdmin();
    const pool = getPool();

    // Check existing leave details
    const existing = await pool.query<{
      user_id: string;
      leave_type: string;
      start_date: string;
      end_date: string;
    }>(
      `SELECT user_id, leave_type, start_date::text, end_date::text FROM public.leaves WHERE id = $1`,
      [data.id]
    );

    const leave = existing.rows[0];

    await pool.query(
      `UPDATE public.leaves
       SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND (user_id = $2 OR EXISTS (
         SELECT 1 FROM public.user_roles WHERE user_id = $2 AND role IN ('admin', 'manager')
       ))`,
      [data.id, context.userId]
    );

    // If a manager or admin cancelled someone else's leave, send notification to the employee
    if (leave && leave.user_id !== context.userId) {
      try {
        const managerProfile = await pool.query<{ display_name: string }>(
          `SELECT display_name FROM public.profiles WHERE id = $1`,
          [context.userId]
        );
        const managerName = managerProfile.rows[0]?.display_name || "Manager";
        const reasonText = data.reason ? ` Reason: "${data.reason}".` : "";

        await pool.query(
          `INSERT INTO public.notifications (user_id, type, title, body)
           VALUES ($1, $2, $3, $4)`,
          [
            leave.user_id,
            "leave_cancelled",
            `❌ Leave Request Cancelled`,
            `Your ${leave.leave_type.toUpperCase()} for ${leave.start_date} to ${leave.end_date} was cancelled by ${managerName}.${reasonText}`,
          ]
        );
      } catch (notifErr) {
        console.warn("[leaves] cancellation notification failed:", notifErr);
      }
    }

    return { success: true };
  });



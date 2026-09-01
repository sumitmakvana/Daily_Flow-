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
  .validator(
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
  .validator(
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

const MonthlyCapacityInputSchema = z.object({
  month: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  teamId: z.string().optional(),
  userId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  projects: z.array(z.string()).optional(),
});

export interface CapacityReportRow {
  teamMember: string;
  projectName: string;
  hours: number;
  autoHours?: number;
  totalWorkingHours: number;
  pctProject: string;
  isTotalRow?: boolean;
  isSeparatorRow?: boolean;
}

export interface ProjectSummaryRow {
  projectName: string;
  teamHours: number;
  totalWorkingHours: number;
  noOfResources: number;
  isTotalRow?: boolean;
}

export const getMonthlyCapacityReportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MonthlyCapacityInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    return await withUser(context.userId, async (client) => {
      // Fetch all distinct project names in the workspace
      const allProjectsRes = await client.query<{ proj_name: string }>(
        `SELECT DISTINCT proj_name FROM (
           SELECT name AS proj_name FROM public.projects WHERE name IS NOT NULL AND name <> ''
           UNION
           SELECT project_name AS proj_name FROM public.tasks WHERE project_name IS NOT NULL AND project_name <> ''
         ) sub WHERE proj_name <> '' ORDER BY proj_name ASC`,
      );
      const availableProjects = allProjectsRes.rows.map((r) => r.proj_name);

      // 1. Resolve date range
      let fromDateStr = "";
      let toDateStr = "";
      let monthLabel = "";

      if (data.month && /^\d{4}-\d{2}$/.test(data.month)) {
        const [yearStr, monthStr] = data.month.split("-");
        const y = parseInt(yearStr, 10);
        const m = parseInt(monthStr, 10);
        fromDateStr = `${data.month}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        toDateStr = `${data.month}-${String(lastDay).padStart(2, "0")}`;
        monthLabel = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      } else if (data.from && data.to) {
        fromDateStr = data.from;
        toDateStr = data.to;
        monthLabel = `${data.from} to ${data.to}`;
      } else {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        const mStr = String(m).padStart(2, "0");
        fromDateStr = `${y}-${mStr}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        toDateStr = `${y}-${mStr}-${String(lastDay).padStart(2, "0")}`;
        monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      }

      // 2. Fetch work settings & holiday calendar
      const settingsRes = await client.query<{ daily_capacity_hours: number }>(
        `SELECT daily_capacity_hours FROM public.work_settings WHERE id = 1`,
      );
      const dailyCapacityHours = Number(settingsRes.rows[0]?.daily_capacity_hours ?? 8);

      const holidaysRes = await client.query<{ calendar_date: string }>(
        `SELECT calendar_date::text FROM public.holiday_calendar WHERE calendar_date >= $1 AND calendar_date <= $2`,
        [fromDateStr, toDateStr],
      );
      const holidaySet = new Set(holidaysRes.rows.map((h) => h.calendar_date));

      // Calculate working days
      let workingDaysCount = 0;
      const curDate = new Date(fromDateStr);
      const endDate = new Date(toDateStr);
      while (curDate <= endDate) {
        const dayOfWeek = curDate.getDay();
        const isoDate = curDate.toISOString().slice(0, 10);
        if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidaySet.has(isoDate)) {
          workingDaysCount++;
        }
        curDate.setDate(curDate.getDate() + 1);
      }
      const totalWorkingHours = workingDaysCount * dailyCapacityHours;

      // 3. Query active profiles (filtered by teamId, userIds, or userId)
      const profileParams: unknown[] = [];
      let profileWhere = `(is_active IS NULL OR is_active = true)`;

      if (data.teamId && data.teamId !== "all") {
        profileParams.push(data.teamId);
        profileWhere += ` AND team_id = $${profileParams.length}`;
      }
      if (data.userIds && data.userIds.length > 0) {
        profileParams.push(data.userIds);
        profileWhere += ` AND id = ANY($${profileParams.length}::uuid[])`;
      } else if (data.userId && data.userId !== "all") {
        profileParams.push(data.userId);
        profileWhere += ` AND id = $${profileParams.length}`;
      }

      const profilesRes = await client.query<{ id: string; display_name: string; team_id: string | null }>(
        `SELECT id, display_name, team_id FROM public.profiles WHERE ${profileWhere} ORDER BY display_name ASC`,
        profileParams,
      );
      const profiles = profilesRes.rows;

      if (!profiles.length) {
        return {
          meta: {
            monthLabel,
            from: fromDateStr,
            to: toDateStr,
            totalWorkingDays: workingDaysCount,
            dailyCapacityHours,
            totalWorkingHours,
            totalMembers: 0,
          },
          rows: [] as CapacityReportRow[],
          projectSummary: [] as ProjectSummaryRow[],
          availableProjects,
        };
      }

      const userIds = profiles.map((p) => p.id);

      // 4. Query Task EOD Submissions (with optional projects/projectId filter)
      const eodParams: unknown[] = [fromDateStr, toDateStr, userIds];
      let eodProjectWhere = "";

      if (data.projects && data.projects.length > 0) {
        eodParams.push(data.projects);
        eodProjectWhere = ` AND (
          t.project_name = ANY($${eodParams.length}::text[])
          OR pr.name = ANY($${eodParams.length}::text[])
          OR pr.id::text = ANY($${eodParams.length}::text[])
          OR t.project_id::text = ANY($${eodParams.length}::text[])
        )`;
      } else if (data.projectId && data.projectId !== "all") {
        eodParams.push(data.projectId);
        eodProjectWhere = ` AND (t.project_id = $4::uuid OR pr.id = $4::uuid OR t.project_name = $4 OR pr.name = $4)`;
      }

      const eodRes = await client.query<{ user_id: string; project_name: string; hours: string; auto_hours: string }>(
        `SELECT e.user_id,
                COALESCE(NULLIF(t.project_name, ''), NULLIF(pr.name, ''), 'Unassigned') AS project_name,
                SUM(e.actual_hours)::text AS hours,
                SUM(COALESCE(t.system_hours, 0))::text AS auto_hours
           FROM public.task_eod_submissions e
           JOIN public.tasks t ON t.id = e.task_id
           LEFT JOIN public.projects pr ON pr.id = t.project_id
          WHERE e.submission_date >= $1 AND e.submission_date <= $2
            AND e.user_id = ANY($3::uuid[])
            ${eodProjectWhere}
          GROUP BY e.user_id, COALESCE(NULLIF(t.project_name, ''), NULLIF(pr.name, ''), 'Unassigned')`,
        eodParams,
      );

      // 5. Query Tasks Direct Hours fallback (with optional projects/projectId filter)
      const tasksParams: unknown[] = [fromDateStr, toDateStr, userIds];
      let tasksProjectWhere = "";

      if (data.projects && data.projects.length > 0) {
        tasksParams.push(data.projects);
        tasksProjectWhere = ` AND (
          t.project_name = ANY($${tasksParams.length}::text[])
          OR pr.name = ANY($${tasksParams.length}::text[])
          OR pr.id::text = ANY($${tasksParams.length}::text[])
          OR t.project_id::text = ANY($${tasksParams.length}::text[])
        )`;
      } else if (data.projectId && data.projectId !== "all") {
        tasksParams.push(data.projectId);
        tasksProjectWhere = ` AND (t.project_id = $4::uuid OR pr.id = $4::uuid OR t.project_name = $4 OR pr.name = $4)`;
      }

      const tasksRes = await client.query<{ user_id: string; project_name: string; hours: string; auto_hours: string }>(
        `SELECT t.assigned_to AS user_id,
                COALESCE(NULLIF(t.project_name, ''), NULLIF(pr.name, ''), 'Unassigned') AS project_name,
                SUM(COALESCE(t.actual_hours, t.planned_hours, 0))::text AS hours,
                SUM(COALESCE(t.system_hours, 0))::text AS auto_hours
           FROM public.tasks t
           LEFT JOIN public.projects pr ON pr.id = t.project_id
          WHERE t.assigned_to = ANY($3::uuid[])
            AND (
              (t.completed_at IS NOT NULL AND t.completed_at::date >= $1 AND t.completed_at::date <= $2)
              OR (t.due_date IS NOT NULL AND t.due_date >= $1 AND t.due_date <= $2)
              OR (t.created_at::date >= $1 AND t.created_at::date <= $2)
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.task_eod_submissions e2 WHERE e2.task_id = t.id
            )
            ${tasksProjectWhere}
          GROUP BY t.assigned_to, COALESCE(NULLIF(t.project_name, ''), NULLIF(pr.name, ''), 'Unassigned')`,
        tasksParams,
      );

      // 6. Query Approved Leaves (safely handle RLS / permission restrictions)
      let leavesRows: Array<{
        user_id: string;
        leave_type: string;
        start_date: string;
        end_date: string;
      }> = [];

      try {
        const leavesRes = await client.query<{
          user_id: string;
          leave_type: string;
          start_date: string;
          end_date: string;
        }>(
          `SELECT l.user_id,
                  l.leave_type,
                  l.start_date::text,
                  l.end_date::text
             FROM public.leaves l
            WHERE l.status <> 'rejected'
              AND l.start_date <= $2
              AND l.end_date >= $1
              AND l.user_id = ANY($3::uuid[])`,
          [fromDateStr, toDateStr, userIds],
        );
        leavesRows = leavesRes.rows;
      } catch (err) {
        console.warn("[getMonthlyCapacityReport] leaves table permission skipped:", (err as Error).message);
      }

      // Organize hours by user
      const userProjectsMap: Record<string, Record<string, number>> = {};
      const userAutoProjectsMap: Record<string, Record<string, number>> = {};
      profiles.forEach((p) => {
        userProjectsMap[p.id] = {};
        userAutoProjectsMap[p.id] = {};
      });

      // Aggregate EOD hours
      eodRes.rows.forEach((r) => {
        const hrs = parseFloat(r.hours) || 0;
        const autoHrs = parseFloat(r.auto_hours || "0") || 0;
        if (userProjectsMap[r.user_id]) {
          if (hrs > 0) userProjectsMap[r.user_id][r.project_name] = (userProjectsMap[r.user_id][r.project_name] || 0) + hrs;
          if (autoHrs > 0) userAutoProjectsMap[r.user_id][r.project_name] = (userAutoProjectsMap[r.user_id][r.project_name] || 0) + autoHrs;
        }
      });

      // Aggregate Direct task hours
      tasksRes.rows.forEach((r) => {
        const hrs = parseFloat(r.hours) || 0;
        const autoHrs = parseFloat(r.auto_hours || "0") || 0;
        if (userProjectsMap[r.user_id]) {
          if (hrs > 0) userProjectsMap[r.user_id][r.project_name] = (userProjectsMap[r.user_id][r.project_name] || 0) + hrs;
          if (autoHrs > 0) userAutoProjectsMap[r.user_id][r.project_name] = (userAutoProjectsMap[r.user_id][r.project_name] || 0) + autoHrs;
        }
      });

      // Aggregate Leave hours
      leavesRows.forEach((l) => {
        if (!userProjectsMap[l.user_id]) return;
        const lStart = new Date(l.start_date > fromDateStr ? l.start_date : fromDateStr);
        const lEnd = new Date(l.end_date < toDateStr ? l.end_date : toDateStr);
        let leaveDays = 0;
        const temp = new Date(lStart);
        while (temp <= lEnd) {
          const dow = temp.getDay();
          const iso = temp.toISOString().slice(0, 10);
          if (dow !== 0 && dow !== 6 && !holidaySet.has(iso)) {
            leaveDays++;
          }
          temp.setDate(temp.getDate() + 1);
        }
        const hoursPerDay = l.leave_type === "half_day" ? 4 : dailyCapacityHours;
        const leaveHrs = leaveDays * hoursPerDay;
        if (leaveHrs > 0) {
          userProjectsMap[l.user_id]["Leave"] = (userProjectsMap[l.user_id]["Leave"] || 0) + leaveHrs;
        }
      });

      // Build structured member report rows
      const reportRows: CapacityReportRow[] = [];

      profiles.forEach((p, pIdx) => {
        const projectHours = userProjectsMap[p.id] || {};
        const autoProjectHours = userAutoProjectsMap[p.id] || {};
        let totalLoggedAndLeave = 0;

        Object.entries(projectHours).forEach(([projName, hrs]) => {
          if (projName !== "Unassigned") {
            totalLoggedAndLeave += hrs;
          }
        });

        // Compute Unassigned hours if any
        if (totalWorkingHours > totalLoggedAndLeave) {
          const unassignedHrs = totalWorkingHours - totalLoggedAndLeave;
          projectHours["Unassigned"] = (projectHours["Unassigned"] || 0) + unassignedHrs;
        }

        const projectEntries = Object.entries(projectHours).filter(([, hrs]) => hrs > 0);

        if (projectEntries.length === 0) {
          projectEntries.push(["Unassigned", totalWorkingHours]);
        }

        // Add rows for each project
        projectEntries.forEach(([projName, hrs]) => {
          const displayHrs = Math.round(hrs * 10) / 10;
          const displayAutoHrs = Math.round((autoProjectHours[projName] || 0) * 10) / 10;
          const pctNum = totalWorkingHours > 0 ? Math.round((hrs / totalWorkingHours) * 100) : 0;
          reportRows.push({
            teamMember: p.display_name,
            projectName: projName,
            hours: displayHrs,
            autoHours: displayAutoHrs,
            totalWorkingHours,
            pctProject: `${pctNum}%`,
          });
        });

        // Total row for member
        reportRows.push({
          teamMember: p.display_name,
          projectName: "Total",
          hours: totalWorkingHours,
          totalWorkingHours,
          pctProject: "100%",
          isTotalRow: true,
        });

        // Separator between members
        if (pIdx < profiles.length - 1) {
          reportRows.push({
            teamMember: "",
            projectName: "",
            hours: 0,
            totalWorkingHours: 0,
            pctProject: "",
            isSeparatorRow: true,
          });
        }
      });

      // Build project summary rows (Project | Team Hours | Total Hours in Month | No of Resources worked on)
      const totalProjectHoursMap: Record<string, number> = {};

      Object.values(userProjectsMap).forEach((pMap) => {
        Object.entries(pMap).forEach(([projName, hrs]) => {
          if (projName !== "Unassigned" && projName !== "Leave" && hrs > 0) {
            totalProjectHoursMap[projName] = (totalProjectHoursMap[projName] || 0) + hrs;
          }
        });
      });

      const projectSummaryRows: ProjectSummaryRow[] = [];
      let overallTeamHours = 0;

      Object.entries(totalProjectHoursMap)
        .sort((a, b) => b[1] - a[1])
        .forEach(([projName, hrs]) => {
          const roundedHrs = Math.round(hrs * 10) / 10;
          overallTeamHours += roundedHrs;
          const resourcesCount = totalWorkingHours > 0 ? Math.round((hrs / totalWorkingHours) * 10) / 10 : 0;
          projectSummaryRows.push({
            projectName: projName,
            teamHours: roundedHrs,
            totalWorkingHours,
            noOfResources: resourcesCount,
          });
        });

      if (projectSummaryRows.length > 0) {
        const totalResourcesCount = totalWorkingHours > 0 ? Math.round((overallTeamHours / totalWorkingHours) * 10) / 10 : 0;
        projectSummaryRows.push({
          projectName: "Total",
          teamHours: Math.round(overallTeamHours * 10) / 10,
          totalWorkingHours,
          noOfResources: totalResourcesCount,
          isTotalRow: true,
        });
      }

      return {
        meta: {
          monthLabel,
          from: fromDateStr,
          to: toDateStr,
          totalWorkingDays: workingDaysCount,
          dailyCapacityHours,
          totalWorkingHours,
          totalMembers: profiles.length,
        },
        rows: reportRows,
        projectSummary: projectSummaryRows,
        availableProjects,
      };
    });
  });



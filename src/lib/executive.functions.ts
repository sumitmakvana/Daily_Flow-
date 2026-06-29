import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  days: z.number().int().min(1).max(90).default(7),
  team: z.string().uuid().nullable().optional(),
  manager: z.string().uuid().nullable().optional(),
  project: z.string().uuid().nullable().optional(),
  type: z.string().uuid().nullable().optional(),
});

export const getExecSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("exec_summary" as never, {
      _days: data.days,
      _team: data.team ?? null,
      _manager: data.manager ?? null,
      _project: data.project ?? null,
      _type: data.type ?? null,
    } as never);
    if (error) throw new Error(error.message);
    return rows as unknown as ExecSummary;
  });

/**
 * Lightweight bootstrap used by the Executive Dashboard to resolve the
 * default scope (E0.1E):
 *   - admin with primary team   → team scope (their team)
 *   - admin without primary team → org scope
 *   - manager (non-admin)        → manager scope (their own hierarchy)
 *
 * Returned in one round-trip so the first exec_summary call can be issued
 * with the correct scope (avoids a wasted unfiltered call).
 */
export const getExecScope = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: profile }, { data: roles }] = await Promise.all([
      context.supabase
        .from("profiles")
        .select("team_id, display_name")
        .eq("id", context.userId)
        .maybeSingle(),
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
    ]);

    const teamId = (profile?.team_id as string | null | undefined) ?? null;
    let teamName: string | null = null;
    if (teamId) {
      const { data: t } = await context.supabase
        .from("teams")
        .select("name")
        .eq("id", teamId)
        .maybeSingle();
      teamName = (t?.name as string | null | undefined) ?? null;
    }

    const set = new Set((roles ?? []).map((r: { role: string }) => r.role));

    return {
      userId: context.userId,
      displayName: (profile?.display_name as string | null | undefined) ?? null,
      isAdmin: set.has("admin"),
      isManager: set.has("manager"),
      primaryTeamId: teamId,
      primaryTeamName: teamName,
    };
  });

export type ExecScopeBootstrap = Awaited<ReturnType<typeof getExecScope>>;

export interface ExecSummary {
  meta: {
    days: number; today: string; range_start: string;
    is_admin: boolean; visible_team_count: number; capacity: number; generated_at: string;
  };
  execution: {
    planned_today: number; completed_today: number;
    week_due: number; week_done: number;
    prev_week_due: number; prev_week_done: number;
  };
  delivery: {
    on_track: number; at_risk: number; delayed: number;
    projects: Array<{ id: string; name: string; status: "on" | "risk" | "late"; overdue: number; blocked: number; total: number }>;
  };
  risk: {
    blocked: number; high: number; sla_breaches: number; approvals_pending: number;
    critical: Array<{ id: string; severity: string; summary: string; entity_type: string; entity_id: string }>;
  };
  workload: { rows: Array<{ user_id: string; name: string | null; planned: number; pct: number }> };
  discipline: {
    cf_today: number; cf_hot: number; eod_today: number; eod_users_range: number;
    eod_total_members: number; blocked_3d: number;
    cf_trend: Array<{ d: string; n: number }>;
  };
  automation: {
    total_runs: number; today_runs: number; success_rate: number | null;
    failed_24h: number; dead_24h: number; pending: number;
    active_rules: number; auto_disabled_rules: number;
    follow_ups: number; approvals_auto: number; escalations: number;
    trend: Array<{ d: string; n: number }>;
  };
  adoption: {
    dau: number; wau: number; eod_users: number; status_users: number; total_members: number;
    dau_trend: Array<{ d: string; n: number }>;
  };
  team_health: Array<{ team: string; manager: string; score: number }>;
  manager_effectiveness: Array<{ manager: string; completion: number; overdue: number; appr: number }>;
  insights_inputs: {
    cf_last_7d: number; cf_prev_7d: number;
    approvals_pending_now: number; approvals_pending_over_7d: number;
    team_overload: Array<{ name: string; pct: number }>;
  };
  filters: {
    teams: Array<{ id: string; name: string }>;
    managers: Array<{ id: string; name: string }>;
    projects: Array<{ id: string; name: string }>;
    types: Array<{ id: string; name: string }>;
  };
}

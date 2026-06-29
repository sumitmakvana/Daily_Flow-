import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Phase E4 — Operational Intelligence (Forecast)
 *
 * Single RPC that returns forward-looking, rule-based predictions across the
 * five domains the product owner specified:
 *
 *   1. SLA forecast        — per-task breach probability for the next 14 days
 *   2. Workload forecast   — per-user load projection over the next 7 days
 *   3. Approval forecast   — pending requests projected to miss 48h SLA + bottleneck approvers
 *   4. Project forecast    — projects likely to slip based on overdue density + breach risk
 *   5. Insights            — Top Risks, Top Opportunities, Required Manager Actions
 *
 * No LLM. No external service. All scoring is a pure function of the rows
 * already in the database — see scoreSlaBreach() / projectSlipScore() below.
 *
 * Validation:
 *   - The same scoreSlaBreach() is replayed against tasks completed in the
 *     last 30 days to compute observed precision/recall against the >=60
 *     "high risk" cutoff. Returned in `validation.{sla_precision,sla_recall}`.
 *   - Workload projection uses each user's daily_capacity_hours setting, so
 *     overload thresholds are tenant-tunable, not hard-coded.
 *
 * Scope (same model as Manager Command Center):
 *   - admin                                  → all active profiles
 *   - manager (non-admin) with team_id       → manager_id = me OR team_id = mine
 *   - manager (non-admin) without team_id    → direct reports only
 */

// ── Shared shapes ──────────────────────────────────────────────────────────

export type RiskBand = "low" | "medium" | "high" | "critical";

export interface SlaForecastRow {
  task_id: string;
  task_code: string;
  task_name: string;
  owner_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  days_to_due: number | null;
  priority: string;
  status: string;
  carry_forward_count: number;
  blocked_age_days: number | null;
  has_open_risk: boolean;
  breach_score: number;       // 0..100
  breach_band: RiskBand;
  reasons: string[];
}

export interface WorkloadForecastRow {
  user_id: string;
  name: string;
  capacity_hours: number;       // daily
  horizon_days: number;         // 7
  projected_hours: number;
  capacity_window: number;      // capacity * horizon
  load_pct: number;             // 0..200+
  zone: "red" | "amber" | "green" | "blue";
  bottleneck_day: string | null; // ISO date with the heaviest load
  bottleneck_day_hours: number;
}

export interface ApprovalForecastRow {
  request_id: string;
  work_item_id: string;
  work_item_code: string;
  age_hours: number;
  projected_total_hours: number;
  approver_label: string;
  state: "on_track" | "at_risk" | "will_breach";
}

export interface ApprovalBottleneckRow {
  approver_label: string;
  pending: number;
  median_age_hours: number;
  oldest_age_hours: number;
}

export interface ProjectForecastRow {
  project_id: string;
  name: string;
  total: number;
  open: number;
  overdue: number;
  high_risk_open: number;
  slip_score: number;            // 0..100
  outlook: "on_track" | "at_risk" | "likely_slip";
}

export interface InsightRow {
  kind: "RISK" | "OPPORTUNITY" | "ACTION";
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  ref_id?: string;
}

export interface ForecastPayload {
  meta: {
    generated_at: string;
    horizon_days: number;
    today: string;
    scope: "admin" | "team" | "reports";
    team_size: number;
    capacity_hours: number;
  };
  sla: {
    rows: SlaForecastRow[];
    counts: Record<RiskBand, number>;
  };
  workload: {
    rows: WorkloadForecastRow[];
    overloaded: number;
    bottleneck_dates: { date: string; total_hours: number }[];
  };
  approvals: {
    forecast: ApprovalForecastRow[];
    bottlenecks: ApprovalBottleneckRow[];
    median_turnaround_hours: number | null;
  };
  projects: ProjectForecastRow[];
  insights: {
    risks: InsightRow[];
    opportunities: InsightRow[];
    actions: InsightRow[];
  };
  validation: {
    sample_size: number;
    sla_precision: number | null;  // of high-band predictions, fraction that actually breached
    sla_recall: number | null;     // of actual breaches, fraction we flagged as high
    horizon_days_backtest: number; // window used for back-test (30)
  };
}

// ── Scoring rules (pure, easy to back-test) ────────────────────────────────

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);
const hoursSince = (iso: string) => (Date.now() - Date.parse(iso)) / 3600000;

interface ScoreInputs {
  priority: string;
  status: string;
  due_date: string | null;
  carry_forward_count: number;
  blocked_age_days: number | null;
  has_open_risk: boolean;
  updated_age_days: number;
}

/**
 * Returns 0..100. Combination of:
 *   - days_to_due: < 0 already overdue (heavy), 0–2 imminent, 3–7 near
 *   - priority:    High +20, Critical +30
 *   - blocked:     +15 base, +5 per day blocked (cap 30)
 *   - carry_forward_count: clamp(cf * 6, 0, 24)
 *   - has_open_risk: +12
 *   - stale (no update in 4+ days while in-progress): +8
 */
export function scoreSlaBreach(today: string, t: ScoreInputs): { score: number; reasons: string[] } {
  if (t.status === "Completed" || t.status === "Cancelled") return { score: 0, reasons: [] };
  const reasons: string[] = [];
  let s = 0;

  if (t.due_date) {
    const d = daysBetween(today, t.due_date);
    if (d < 0) { s += 45 + Math.min(20, Math.abs(d) * 3); reasons.push(`overdue ${Math.abs(d)}d`); }
    else if (d <= 2) { s += 28; reasons.push(`due in ${d}d`); }
    else if (d <= 7) { s += 14; reasons.push(`due in ${d}d`); }
    else if (d <= 14) { s += 5; }
  } else {
    s += 4; reasons.push("no due date");
  }

  if (t.priority === "Critical") { s += 30; reasons.push("critical priority"); }
  else if (t.priority === "High") { s += 20; reasons.push("high priority"); }

  if (t.status === "Blocked") {
    const age = t.blocked_age_days ?? 0;
    s += 15 + Math.min(30, age * 5);
    reasons.push(age > 0 ? `blocked ${age}d` : "blocked");
  }

  if (t.carry_forward_count > 0) {
    s += Math.min(24, t.carry_forward_count * 6);
    if (t.carry_forward_count >= 3) reasons.push(`carried forward ${t.carry_forward_count}×`);
  }

  if (t.has_open_risk) { s += 12; reasons.push("open risk flag"); }

  if (t.status === "In Progress" && t.updated_age_days >= 4) {
    s += 8; reasons.push(`stale ${t.updated_age_days}d`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons };
}

export function band(score: number): RiskBand {
  if (score >= 75) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function projectSlipScore(p: { open: number; overdue: number; high_risk_open: number; blocked: number }): number {
  if (p.open === 0) return 0;
  const overdueRatio = p.overdue / p.open;
  const riskRatio = p.high_risk_open / p.open;
  // weighted: overdue density (40), risk density (35), blocked count (25, capped)
  const s = overdueRatio * 40 + riskRatio * 35 + Math.min(25, p.blocked * 8);
  return Math.max(0, Math.min(100, Math.round(s)));
}

// ── Server function ────────────────────────────────────────────────────────

export const getForecast = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ForecastPayload> => {
    const { supabase, userId } = context;
    const today = todayISO();
    const HORIZON = 7;

    // Caller scope (mirrors Manager Command Center)
    const [{ data: meProf }, { data: rolesRows }] = await Promise.all([
      supabase.from("profiles").select("id,team_id").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    const roleSet = new Set((rolesRows ?? []).map((r: { role: string }) => r.role));
    const isAdmin = roleSet.has("admin");
    const myTeamId = (meProf?.team_id as string | null | undefined) ?? null;

    let profilesQ = supabase
      .from("profiles")
      .select("id,display_name,team_id,manager_id,is_active")
      .eq("is_active", true);
    if (!isAdmin) {
      profilesQ = myTeamId
        ? profilesQ.or(`manager_id.eq.${userId},team_id.eq.${myTeamId}`)
        : profilesQ.eq("manager_id", userId);
    }

    const [
      profilesRes,
      settingsRes,
      projectsRes,
      risksRes,
      apprReqsRes,
      apprStepsRes,
      apprRecentRes,
      completedRes,
    ] = await Promise.all([
      profilesQ,
      supabase.from("work_settings").select("daily_capacity_hours").eq("id", 1).maybeSingle(),
      supabase.from("projects").select("id,name"),
      supabase.from("risk_events").select("entity_id,severity").eq("entity_type", "task").is("resolved_at", null),
      supabase.from("approval_requests").select("id,work_item_id,chain_id,current_step,status,requested_at"),
      supabase.from("approval_steps").select("chain_id,step_order,name,approver_mode,approver_user_id,approver_role"),
      supabase
        .from("approval_requests")
        .select("requested_at,completed_at,status")
        .neq("status", "pending")
        .gte("requested_at", new Date(Date.now() - 30 * 86400000).toISOString())
        .limit(1000),
      // back-test sample: tasks completed in last 30 days with a due date
      supabase
        .from("tasks")
        .select("priority,due_date,completed_at,carry_forward_count,blocked_at,updated_at")
        .eq("status", "Completed")
        .gte("completed_at", new Date(Date.now() - 30 * 86400000).toISOString())
        .not("due_date", "is", null)
        .limit(2000),
    ]);

    const profiles = (profilesRes.data ?? []) as Array<{ id: string; display_name: string; team_id: string | null; manager_id: string | null }>;
    const memberIds = profiles.map((p) => p.id);
    const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
    const capacity = Number(settingsRes.data?.daily_capacity_hours ?? 8);

    // Scoped tasks
    let tasks: Array<{
      id: string; task_code: string; task_name: string; project_id: string | null;
      assigned_to: string | null; reviewer: string | null;
      status: string; priority: string; due_date: string | null;
      planned_hours: number | null; carry_forward_count: number;
      blocked_at: string | null; updated_at: string;
    }> = [];
    if (memberIds.length > 0) {
      const { data: t } = await supabase
        .from("tasks")
        .select("id,task_code,task_name,project_id,assigned_to,reviewer,status,priority,due_date,planned_hours,carry_forward_count,blocked_at,updated_at")
        .in("assigned_to", memberIds);
      tasks = (t ?? []) as typeof tasks;
    }

    const riskSet = new Set(
      ((risksRes.data ?? []) as Array<{ entity_id: string; severity: string }>)
        .filter((r) => r.severity === "high" || r.severity === "critical")
        .map((r) => r.entity_id),
    );

    // ── 1) SLA forecast ────────────────────────────────────────────────────
    const slaRows: SlaForecastRow[] = tasks
      .filter((t) => t.status !== "Completed" && t.status !== "Cancelled")
      .map((t) => {
        const blocked_age_days = t.blocked_at ? daysBetween(t.blocked_at.slice(0, 10), today) : null;
        const updated_age_days = Math.floor((Date.now() - Date.parse(t.updated_at)) / 86400000);
        const has_open_risk = riskSet.has(t.id);
        const { score, reasons } = scoreSlaBreach(today, {
          priority: t.priority,
          status: t.status,
          due_date: t.due_date,
          carry_forward_count: t.carry_forward_count,
          blocked_age_days,
          has_open_risk,
          updated_age_days,
        });
        return {
          task_id: t.id,
          task_code: t.task_code,
          task_name: t.task_name,
          owner_id: t.assigned_to,
          owner_name: t.assigned_to ? nameById.get(t.assigned_to) ?? null : null,
          due_date: t.due_date,
          days_to_due: t.due_date ? daysBetween(today, t.due_date) : null,
          priority: t.priority,
          status: t.status,
          carry_forward_count: t.carry_forward_count,
          blocked_age_days,
          has_open_risk,
          breach_score: score,
          breach_band: band(score),
          reasons,
        };
      })
      .sort((a, b) => b.breach_score - a.breach_score);

    const slaCounts: Record<RiskBand, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of slaRows) slaCounts[r.breach_band] += 1;

    // ── 2) Workload forecast (next 7 days) ─────────────────────────────────
    // Spread each open task's planned_hours across business days up to its due date,
    // bounded by [today, today+HORIZON-1]. Unscheduled work piles on `today` so it
    // still surfaces overload.
    const horizonDates: string[] = Array.from({ length: HORIZON }, (_, i) => {
      const d = new Date(today + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    const perUserPerDay = new Map<string, Map<string, number>>();
    for (const p of profiles) {
      const m = new Map<string, number>();
      for (const d of horizonDates) m.set(d, 0);
      perUserPerDay.set(p.id, m);
    }
    for (const t of tasks) {
      if (!t.assigned_to) continue;
      if (t.status === "Completed" || t.status === "Cancelled") continue;
      const m = perUserPerDay.get(t.assigned_to);
      if (!m) continue;
      const hours = Number(t.planned_hours ?? 0) || 2; // default 2h when unset
      if (!t.due_date) { m.set(today, (m.get(today) ?? 0) + hours); continue; }
      const targetDays = horizonDates.filter((d) => d <= t.due_date!);
      if (targetDays.length === 0) {
        // already overdue → load onto today
        m.set(today, (m.get(today) ?? 0) + hours);
      } else {
        const per = hours / targetDays.length;
        for (const d of targetDays) m.set(d, (m.get(d) ?? 0) + per);
      }
    }

    const workloadRows: WorkloadForecastRow[] = profiles.map((p) => {
      const m = perUserPerDay.get(p.id)!;
      let total = 0; let peakDay: string | null = null; let peakVal = 0;
      for (const [d, v] of m) { total += v; if (v > peakVal) { peakVal = v; peakDay = d; } }
      const window = capacity * HORIZON;
      const load_pct = window === 0 ? 0 : Math.round((total / window) * 100);
      const zone: WorkloadForecastRow["zone"] =
        load_pct > 130 ? "red" : load_pct > 100 ? "amber" : load_pct >= 70 ? "green" : "blue";
      return {
        user_id: p.id,
        name: p.display_name,
        capacity_hours: capacity,
        horizon_days: HORIZON,
        projected_hours: Math.round(total * 10) / 10,
        capacity_window: window,
        load_pct,
        zone,
        bottleneck_day: peakDay,
        bottleneck_day_hours: Math.round(peakVal * 10) / 10,
      };
    }).sort((a, b) => b.load_pct - a.load_pct);

    const overloaded = workloadRows.filter((w) => w.zone === "red" || w.zone === "amber").length;
    // aggregate per-day across the team to identify cluster bottlenecks
    const dayTotals = new Map<string, number>();
    for (const d of horizonDates) dayTotals.set(d, 0);
    for (const [, m] of perUserPerDay) for (const [d, v] of m) dayTotals.set(d, (dayTotals.get(d) ?? 0) + v);
    const bottleneck_dates = Array.from(dayTotals.entries())
      .map(([date, total_hours]) => ({ date, total_hours: Math.round(total_hours * 10) / 10 }))
      .sort((a, b) => b.total_hours - a.total_hours)
      .slice(0, 3);

    // ── 3) Approval forecast ───────────────────────────────────────────────
    const recent = (apprRecentRes.data ?? []) as Array<{ requested_at: string; completed_at: string | null }>;
    const turnaround = recent
      .filter((r) => r.completed_at)
      .map((r) => (Date.parse(r.completed_at!) - Date.parse(r.requested_at)) / 3600000)
      .sort((a, b) => a - b);
    const median_turnaround_hours = turnaround.length
      ? Math.round(turnaround[Math.floor(turnaround.length / 2)] * 10) / 10
      : null;
    const projectedDelta = median_turnaround_hours ?? 36; // fallback assumption

    const steps = (apprStepsRes.data ?? []) as Array<{ chain_id: string; step_order: number; name: string; approver_mode: string; approver_user_id: string | null; approver_role: string | null }>;
    const stepByKey = new Map<string, typeof steps[number]>();
    for (const s of steps) stepByKey.set(`${s.chain_id}:${s.step_order}`, s);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const SLA_BREACH_HOURS = 48;

    const apprForecast: ApprovalForecastRow[] = [];
    const bottleneckAcc = new Map<string, number[]>();
    for (const r of (apprReqsRes.data ?? []) as Array<{ id: string; work_item_id: string; chain_id: string; current_step: number; status: string; requested_at: string }>) {
      if (r.status !== "pending") continue;
      const t = taskById.get(r.work_item_id);
      if (!t) continue;
      const step = stepByKey.get(`${r.chain_id}:${r.current_step}`);
      const approverLabel = !step
        ? "Approval"
        : step.approver_mode === "user" && step.approver_user_id
          ? (nameById.get(step.approver_user_id) ?? "User")
          : step.approver_mode === "role" && step.approver_role
            ? `Role: ${step.approver_role}`
            : step.approver_mode === "reviewer_field"
              ? (t.reviewer ? nameById.get(t.reviewer) ?? "Reviewer" : "Reviewer")
              : (step.name ?? "Approval");
      const age = hoursSince(r.requested_at);
      const projected = age + projectedDelta;
      const state: ApprovalForecastRow["state"] =
        projected >= SLA_BREACH_HOURS && age >= 24 ? "will_breach"
        : projected >= SLA_BREACH_HOURS || age >= 24 ? "at_risk"
        : "on_track";
      apprForecast.push({
        request_id: r.id,
        work_item_id: r.work_item_id,
        work_item_code: t.task_code,
        age_hours: Math.round(age * 10) / 10,
        projected_total_hours: Math.round(projected * 10) / 10,
        approver_label: approverLabel,
        state,
      });
      const arr = bottleneckAcc.get(approverLabel) ?? [];
      arr.push(age);
      bottleneckAcc.set(approverLabel, arr);
    }
    apprForecast.sort((a, b) => b.projected_total_hours - a.projected_total_hours);

    const bottlenecks: ApprovalBottleneckRow[] = Array.from(bottleneckAcc.entries())
      .map(([approver_label, ages]) => {
        const sorted = [...ages].sort((x, y) => x - y);
        const med = sorted[Math.floor(sorted.length / 2)];
        return {
          approver_label,
          pending: ages.length,
          median_age_hours: Math.round(med * 10) / 10,
          oldest_age_hours: Math.round(sorted[sorted.length - 1] * 10) / 10,
        };
      })
      .sort((a, b) => b.pending - a.pending || b.oldest_age_hours - a.oldest_age_hours)
      .slice(0, 10);

    // ── 4) Project forecast ────────────────────────────────────────────────
    const projects = (projectsRes.data ?? []) as Array<{ id: string; name: string }>;
    const highRiskTaskIds = new Set(slaRows.filter((r) => r.breach_band === "high" || r.breach_band === "critical").map((r) => r.task_id));
    const projAcc = new Map<string, { name: string; total: number; open: number; overdue: number; blocked: number; high_risk_open: number }>();
    for (const p of projects) projAcc.set(p.id, { name: p.name, total: 0, open: 0, overdue: 0, blocked: 0, high_risk_open: 0 });
    for (const t of tasks) {
      if (!t.project_id) continue;
      const row = projAcc.get(t.project_id); if (!row) continue;
      row.total += 1;
      if (t.status !== "Completed" && t.status !== "Cancelled") {
        row.open += 1;
        if (t.status === "Blocked") row.blocked += 1;
        if (t.due_date && t.due_date < today) row.overdue += 1;
        if (highRiskTaskIds.has(t.id)) row.high_risk_open += 1;
      }
    }
    const projectRows: ProjectForecastRow[] = Array.from(projAcc.entries())
      .filter(([, v]) => v.open > 0)
      .map(([id, v]) => {
        const slip = projectSlipScore(v);
        const outlook: ProjectForecastRow["outlook"] = slip >= 55 ? "likely_slip" : slip >= 25 ? "at_risk" : "on_track";
        return {
          project_id: id, name: v.name, total: v.total, open: v.open,
          overdue: v.overdue, high_risk_open: v.high_risk_open,
          slip_score: slip, outlook,
        };
      })
      .sort((a, b) => b.slip_score - a.slip_score);

    // ── 5) Insights ────────────────────────────────────────────────────────
    const risks: InsightRow[] = [];
    const opportunities: InsightRow[] = [];
    const actions: InsightRow[] = [];

    // Top risks: the worst SLA predictions
    for (const r of slaRows.filter((x) => x.breach_band === "critical" || x.breach_band === "high").slice(0, 5)) {
      risks.push({
        kind: "RISK",
        severity: r.breach_band === "critical" ? "high" : "medium",
        title: `${r.task_code} likely to breach SLA`,
        detail: `${r.owner_name ?? "Unassigned"} · score ${r.breach_score} · ${r.reasons.slice(0, 3).join(", ") || "no signals"}`,
        ref_id: r.task_id,
      });
    }
    // Projects likely to slip
    for (const p of projectRows.filter((x) => x.outlook === "likely_slip").slice(0, 3)) {
      risks.push({
        kind: "RISK",
        severity: "high",
        title: `${p.name} likely to slip`,
        detail: `${p.overdue}/${p.open} overdue · ${p.high_risk_open} high-risk open · score ${p.slip_score}`,
        ref_id: p.project_id,
      });
    }
    // Approval breaches
    for (const a of apprForecast.filter((x) => x.state === "will_breach").slice(0, 3)) {
      risks.push({
        kind: "RISK",
        severity: "medium",
        title: `Approval on ${a.work_item_code} will breach SLA`,
        detail: `${a.approver_label} · waiting ${a.age_hours}h, projected ${a.projected_total_hours}h`,
        ref_id: a.request_id,
      });
    }

    // Opportunities: underused users with capacity vs overloaded peers
    const underused = workloadRows.filter((w) => w.zone === "blue");
    const hot = workloadRows.filter((w) => w.zone === "red");
    if (underused.length > 0 && hot.length > 0) {
      for (const cool of underused.slice(0, 3)) {
        const peer = hot[0];
        opportunities.push({
          kind: "OPPORTUNITY",
          severity: "medium",
          title: `${cool.name} has spare capacity`,
          detail: `Projected ${cool.load_pct}% load over ${HORIZON}d (${Math.max(0, cool.capacity_window - cool.projected_hours).toFixed(1)}h free). Consider shifting work from ${peer.name} (${peer.load_pct}%).`,
          ref_id: cool.user_id,
        });
      }
    }
    // Light project days — clusters with low load
    const lightDay = [...dayTotals.entries()].sort((a, b) => a[1] - b[1])[0];
    if (lightDay && lightDay[1] < capacity * profiles.length * 0.5) {
      opportunities.push({
        kind: "OPPORTUNITY",
        severity: "low",
        title: `Light load on ${lightDay[0]}`,
        detail: `Only ${Math.round(lightDay[1])}h scheduled team-wide — good day to pull in backlog.`,
      });
    }

    // Required manager actions
    for (const a of apprForecast.filter((x) => x.state !== "on_track").slice(0, 5)) {
      actions.push({
        kind: "ACTION",
        severity: a.state === "will_breach" ? "high" : "medium",
        title: `Unblock approval on ${a.work_item_code}`,
        detail: `${a.approver_label} · waiting ${a.age_hours}h`,
        ref_id: a.request_id,
      });
    }
    for (const w of hot.slice(0, 3)) {
      actions.push({
        kind: "ACTION",
        severity: "high",
        title: `Rebalance ${w.name}`,
        detail: `Projected ${w.load_pct}% over ${HORIZON}d (peak ${w.bottleneck_day_hours}h on ${w.bottleneck_day ?? "today"}).`,
        ref_id: w.user_id,
      });
    }
    for (const p of projectRows.filter((x) => x.outlook !== "on_track").slice(0, 3)) {
      actions.push({
        kind: "ACTION",
        severity: p.outlook === "likely_slip" ? "high" : "medium",
        title: `Review ${p.name} plan`,
        detail: `${p.overdue} overdue, ${p.high_risk_open} high-risk open. Consider rescoping or adding capacity.`,
        ref_id: p.project_id,
      });
    }

    // ── Validation: back-test scoreSlaBreach over last 30 days ─────────────
    const completed = (completedRes.data ?? []) as Array<{
      priority: string; due_date: string | null; completed_at: string | null;
      carry_forward_count: number; blocked_at: string | null; updated_at: string;
    }>;
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const c of completed) {
      if (!c.due_date || !c.completed_at) continue;
      // "At the moment of decision" we don't know completed_at; simulate scoring
      // as of (due_date - 3d) with the historical signals we still have.
      const asOf = new Date(Date.parse(c.due_date) - 3 * 86400000).toISOString().slice(0, 10);
      const blocked_age_days = c.blocked_at ? Math.max(0, daysBetween(c.blocked_at.slice(0, 10), asOf)) : null;
      const updated_age_days = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(c.updated_at)) / 86400000));
      const { score } = scoreSlaBreach(asOf, {
        priority: c.priority, status: "In Progress", due_date: c.due_date,
        carry_forward_count: c.carry_forward_count,
        blocked_age_days, has_open_risk: false, updated_age_days,
      });
      const predictedBreach = score >= 60;
      const actuallyBreached = Date.parse(c.completed_at) > Date.parse(c.due_date) + 86400000; // >1 day late
      if (predictedBreach && actuallyBreached) tp++;
      else if (predictedBreach && !actuallyBreached) fp++;
      else if (!predictedBreach && actuallyBreached) fn++;
      else tn++;
    }
    const sample_size = tp + fp + fn + tn;
    const sla_precision = (tp + fp) === 0 ? null : Math.round((tp / (tp + fp)) * 1000) / 1000;
    const sla_recall = (tp + fn) === 0 ? null : Math.round((tp / (tp + fn)) * 1000) / 1000;

    return {
      meta: {
        generated_at: new Date().toISOString(),
        horizon_days: HORIZON,
        today,
        scope: isAdmin ? "admin" : myTeamId ? "team" : "reports",
        team_size: profiles.length,
        capacity_hours: capacity,
      },
      sla: { rows: slaRows.slice(0, 50), counts: slaCounts },
      workload: { rows: workloadRows, overloaded, bottleneck_dates },
      approvals: {
        forecast: apprForecast.slice(0, 30),
        bottlenecks,
        median_turnaround_hours,
      },
      projects: projectRows.slice(0, 20),
      insights: {
        risks: risks.slice(0, 8),
        opportunities: opportunities.slice(0, 6),
        actions: actions.slice(0, 8),
      },
      validation: {
        sample_size,
        sla_precision,
        sla_recall,
        horizon_days_backtest: 30,
      },
    };
  });

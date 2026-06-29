import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Manager Command Center (E2).
 *
 * Single round-trip rollup for managers:
 *   1. Team health KPIs
 *   2. Per-person capacity (load %, planned, remaining)
 *   3. At-risk work (blocked / delayed / high-severity / repeat carry-forward)
 *   4. Rule-based recommendations (REASSIGN / ESCALATE / FOLLOW_UP / APPROVE)
 *   5. Project health (on-track / at-risk / delayed)
 *   6. Approval queue (pending, with aging)
 *
 * Scope:
 *   - admin                                  → all profiles & tasks
 *   - manager (non-admin) with team_id       → that team (manager_id = me OR team_id = mine)
 *   - manager (non-admin) without team_id    → direct reports only (manager_id = me)
 *
 * All reads are RLS-bound. No service-role usage.
 */

export interface ManagerKpis {
  health_score: number;          // 0–100 composite
  completion_pct: number;
  blocked_pct: number;
  carry_forward_pct: number;
  approval_turnaround_hours: number | null;
  team_size: number;
  total_open: number;
}

export interface CapacityRow {
  user_id: string;
  name: string;
  planned_hours: number;
  capacity_hours: number;
  load_pct: number;              // 0..200+
  remaining_hours: number;
  zone: "red" | "green" | "blue"; // >120 red · 80..120 green · <60 blue
  open: number;
  blocked: number;
  overdue: number;
}

export interface AtRiskRow {
  id: string;
  task_code: string;
  task_name: string;
  owner_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  status: string;
  priority: string;
  carry_forward_count: number;
  blocked_age_days: number | null;
  risk_severity: "low" | "medium" | "high" | "critical" | null;
  reason: "blocked" | "delayed" | "high_risk" | "repeat_cf";
}

export interface ManagerAction {
  kind: "REASSIGN" | "ESCALATE" | "FOLLOW_UP" | "APPROVE";
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  target_user_id?: string | null;
  target_work_item_id?: string | null;
  target_request_id?: string | null;
}

export interface ProjectHealthRow {
  id: string;
  name: string;
  total: number;
  open: number;
  overdue: number;
  blocked: number;
  status: "on" | "risk" | "late";
}

export interface ApprovalQueueRow {
  request_id: string;
  work_item_id: string;
  work_item_code: string;
  work_item_name: string;
  step_name: string;
  requested_at: string;
  age_hours: number;
  state: "pending" | "aging" | "escalated";  // <24h, 24-72h, >72h
}

export interface ManagerCommandPayload {
  meta: {
    scope: "admin" | "team" | "reports";
    user_id: string;
    today: string;
    generated_at: string;
    capacity_hours: number;
    team_size: number;
  };
  kpis: ManagerKpis;
  capacity: CapacityRow[];
  at_risk: {
    blocked: AtRiskRow[];
    delayed: AtRiskRow[];
    high_risk: AtRiskRow[];
    repeat_cf: AtRiskRow[];
  };
  actions: ManagerAction[];
  projects: ProjectHealthRow[];
  approvals: {
    pending: ApprovalQueueRow[];
    counts: { total: number; pending: number; aging: number; escalated: number };
  };
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.max(0, Math.floor((Date.parse(b) - Date.parse(a)) / 86400000));
const hoursSince = (iso: string) => (Date.now() - Date.parse(iso)) / 3600000;

export const getManagerCommand = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ManagerCommandPayload> => {
    const { supabase, userId } = context;
    const today = todayISO();

    // Caller identity + scope
    const [{ data: meProf }, { data: rolesRows }] = await Promise.all([
      supabase.from("profiles").select("id,team_id").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    const roleSet = new Set((rolesRows ?? []).map((r: { role: string }) => r.role));
    const isAdmin = roleSet.has("admin");
    const myTeamId = (meProf?.team_id as string | null | undefined) ?? null;

    // Resolve team members in scope
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
    ] = await Promise.all([
      profilesQ,
      supabase.from("work_settings").select("daily_capacity_hours").eq("id", 1).maybeSingle(),
      supabase.from("projects").select("id,name,team_id,status"),
      supabase.from("risk_events").select("entity_id,severity").eq("entity_type", "task").is("resolved_at", null),
      supabase.from("approval_requests").select("id,work_item_id,chain_id,current_step,status,requested_at,completed_at,updated_at"),
      supabase.from("approval_steps").select("chain_id,step_order,name,approver_mode,approver_user_id,approver_role"),
      supabase
        .from("approval_requests")
        .select("requested_at,completed_at,status")
        .neq("status", "pending")
        .gte("requested_at", new Date(Date.now() - 14 * 86400000).toISOString())
        .limit(500),
    ]);

    const profiles = (profilesRes.data ?? []) as Array<{ id: string; display_name: string; team_id: string | null; manager_id: string | null }>;
    const memberIds = profiles.map((p) => p.id);
    const nameById = new Map(profiles.map((p) => [p.id, p.display_name]));
    const capacity = Number(settingsRes.data?.daily_capacity_hours ?? 8);

    // Tasks scoped to those owners
    let tasks: Array<{
      id: string; task_code: string; task_name: string; project_id: string | null; project_name: string | null;
      assigned_to: string | null; reviewer: string | null;
      status: string; priority: string; due_date: string | null;
      planned_hours: number | null; carry_forward_count: number;
      blocked_at: string | null; completed_at: string | null; updated_at: string;
    }> = [];
    if (memberIds.length > 0) {
      const { data: t } = await supabase
        .from("tasks")
        .select("id,task_code,task_name,project_id,project_name,assigned_to,reviewer,status,priority,due_date,planned_hours,carry_forward_count,blocked_at,completed_at,updated_at")
        .in("assigned_to", memberIds);
      tasks = (t ?? []) as typeof tasks;
    }

    // ── KPIs ──────────────────────────────────────────────────────────────
    const total = tasks.length || 1;
    const open = tasks.filter((t) => t.status !== "Completed");
    const completed = tasks.length - open.length;
    const blocked = tasks.filter((t) => t.status === "Blocked").length;
    const cfHot = tasks.filter((t) => t.carry_forward_count >= 3).length;
    const completion_pct = Math.round((completed / total) * 100);
    const blocked_pct = Math.round((blocked / total) * 100);
    const carry_forward_pct = Math.round((cfHot / total) * 100);

    const recent = (apprRecentRes.data ?? []) as Array<{ requested_at: string; completed_at: string | null }>;
    const turnaroundSamples = recent
      .filter((r) => r.completed_at)
      .map((r) => (Date.parse(r.completed_at!) - Date.parse(r.requested_at)) / 3600000);
    const approval_turnaround_hours = turnaroundSamples.length
      ? Math.round((turnaroundSamples.reduce((a, b) => a + b, 0) / turnaroundSamples.length) * 10) / 10
      : null;

    // Health: weighted composite (higher = healthier)
    const health_score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          completion_pct * 0.45 -
            blocked_pct * 1.2 -
            carry_forward_pct * 1.0 +
            (approval_turnaround_hours == null ? 0 : Math.max(-15, 15 - approval_turnaround_hours / 4)) +
            50, // baseline
        ),
      ),
    );

    // ── Capacity per person ───────────────────────────────────────────────
    type Acc = { planned: number; open: number; blocked: number; overdue: number };
    const acc = new Map<string, Acc>();
    for (const p of profiles) acc.set(p.id, { planned: 0, open: 0, blocked: 0, overdue: 0 });
    for (const t of tasks) {
      if (!t.assigned_to) continue;
      const a = acc.get(t.assigned_to); if (!a) continue;
      if (t.status === "Completed") continue;
      a.open += 1;
      // count planned hours for items due today or already due
      if (t.due_date && t.due_date <= today) a.planned += Number(t.planned_hours ?? 0);
      if (t.status === "Blocked") a.blocked += 1;
      if (t.due_date && t.due_date < today && t.status !== "Completed") a.overdue += 1;
    }
    const capRows: CapacityRow[] = profiles.map((p) => {
      const a = acc.get(p.id)!;
      const load_pct = capacity === 0 ? 0 : Math.round((a.planned / capacity) * 100);
      const zone: CapacityRow["zone"] = load_pct > 120 ? "red" : load_pct >= 80 ? "green" : load_pct < 60 ? "blue" : "green";
      return {
        user_id: p.id,
        name: p.display_name,
        planned_hours: Math.round(a.planned * 10) / 10,
        capacity_hours: capacity,
        load_pct,
        remaining_hours: Math.max(0, Math.round((capacity - a.planned) * 10) / 10),
        zone,
        open: a.open,
        blocked: a.blocked,
        overdue: a.overdue,
      };
    }).sort((x, y) => y.load_pct - x.load_pct);

    // ── At-risk buckets ───────────────────────────────────────────────────
    const SEV = { low: 1, medium: 2, high: 3, critical: 4 } as const;
    const riskByTask = new Map<string, keyof typeof SEV>();
    for (const r of (risksRes.data ?? []) as Array<{ entity_id: string; severity: string }>) {
      const sev = r.severity as keyof typeof SEV;
      const cur = riskByTask.get(r.entity_id);
      if (!cur || SEV[sev] > SEV[cur]) riskByTask.set(r.entity_id, sev);
    }
    const toRow = (t: typeof tasks[number], reason: AtRiskRow["reason"]): AtRiskRow => ({
      id: t.id, task_code: t.task_code, task_name: t.task_name,
      owner_id: t.assigned_to, owner_name: t.assigned_to ? nameById.get(t.assigned_to) ?? null : null,
      due_date: t.due_date, status: t.status, priority: t.priority,
      carry_forward_count: t.carry_forward_count,
      blocked_age_days: t.blocked_at ? daysBetween(t.blocked_at.slice(0, 10), today) : null,
      risk_severity: riskByTask.get(t.id) ?? null,
      reason,
    });
    const blockedRows = open.filter((t) => t.status === "Blocked").map((t) => toRow(t, "blocked"));
    const delayedRows = open.filter((t) => t.due_date && t.due_date < today && t.status !== "Blocked").map((t) => toRow(t, "delayed"));
    const highRiskRows = open.filter((t) => {
      const s = riskByTask.get(t.id);
      return s === "high" || s === "critical";
    }).map((t) => toRow(t, "high_risk"));
    const repeatCfRows = open.filter((t) => t.carry_forward_count >= 3).map((t) => toRow(t, "repeat_cf"));

    // ── Approval queue (mine + my team's) ─────────────────────────────────
    const reqs = (apprReqsRes.data ?? []) as Array<{ id: string; work_item_id: string; chain_id: string; current_step: number; status: string; requested_at: string }>;
    const steps = (apprStepsRes.data ?? []) as Array<{ chain_id: string; step_order: number; name: string; approver_mode: string; approver_user_id: string | null; approver_role: string | null }>;
    const stepByKey = new Map<string, typeof steps[number]>();
    for (const s of steps) stepByKey.set(`${s.chain_id}:${s.step_order}`, s);
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const queue: ApprovalQueueRow[] = [];
    for (const r of reqs) {
      if (r.status !== "pending") continue;
      const step = stepByKey.get(`${r.chain_id}:${r.current_step}`);
      const t = taskById.get(r.work_item_id);
      // Only surface approvals related to our scoped work items
      if (!t) continue;
      const age = hoursSince(r.requested_at);
      const state: ApprovalQueueRow["state"] = age < 24 ? "pending" : age <= 72 ? "aging" : "escalated";
      queue.push({
        request_id: r.id,
        work_item_id: r.work_item_id,
        work_item_code: t.task_code,
        work_item_name: t.task_name,
        step_name: step?.name ?? "Approval",
        requested_at: r.requested_at,
        age_hours: Math.round(age * 10) / 10,
        state,
      });
    }
    queue.sort((a, b) => b.age_hours - a.age_hours);
    const apprCounts = {
      total: queue.length,
      pending: queue.filter((q) => q.state === "pending").length,
      aging: queue.filter((q) => q.state === "aging").length,
      escalated: queue.filter((q) => q.state === "escalated").length,
    };

    // ── Project health ────────────────────────────────────────────────────
    const projects = (projectsRes.data ?? []) as Array<{ id: string; name: string }>;
    const byProj = new Map<string, { name: string; total: number; open: number; overdue: number; blocked: number }>();
    for (const p of projects) byProj.set(p.id, { name: p.name, total: 0, open: 0, overdue: 0, blocked: 0 });
    for (const t of tasks) {
      if (!t.project_id) continue;
      const row = byProj.get(t.project_id);
      if (!row) continue;
      row.total += 1;
      if (t.status !== "Completed") row.open += 1;
      if (t.status === "Blocked") row.blocked += 1;
      if (t.due_date && t.due_date < today && t.status !== "Completed") row.overdue += 1;
    }
    const projectRows: ProjectHealthRow[] = Array.from(byProj.entries())
      .filter(([, v]) => v.total > 0)
      .map(([id, v]) => {
        const overdueRatio = v.open === 0 ? 0 : v.overdue / v.open;
        const status: ProjectHealthRow["status"] = overdueRatio > 0.3 || v.blocked >= 3 ? "late" : overdueRatio > 0.1 || v.blocked >= 1 ? "risk" : "on";
        return { id, name: v.name, total: v.total, open: v.open, overdue: v.overdue, blocked: v.blocked, status };
      })
      .sort((a, b) => (a.status === b.status ? b.overdue - a.overdue : (a.status === "late" ? -1 : b.status === "late" ? 1 : a.status === "risk" ? -1 : 1)));

    // ── Recommendations (rule-based) ──────────────────────────────────────
    const actions: ManagerAction[] = [];

    // REASSIGN: an overloaded person + an underused person
    const overloaded = capRows.filter((c) => c.zone === "red");
    const underused = capRows.filter((c) => c.zone === "blue");
    for (const hot of overloaded.slice(0, 3)) {
      const cool = underused[0];
      if (!cool) break;
      actions.push({
        kind: "REASSIGN",
        priority: "high",
        title: `Rebalance ${hot.name}`,
        detail: `${hot.name} is at ${hot.load_pct}% load; ${cool.name} has ${cool.remaining_hours}h free. Reassign 1–2 items.`,
        target_user_id: hot.user_id,
      });
    }

    // ESCALATE: blocked > 3 days
    for (const row of blockedRows.filter((r) => (r.blocked_age_days ?? 0) >= 3).slice(0, 5)) {
      actions.push({
        kind: "ESCALATE",
        priority: "high",
        title: `Escalate ${row.task_code}`,
        detail: `Blocked ${row.blocked_age_days}d (${row.owner_name ?? "unassigned"}). Needs manager intervention.`,
        target_work_item_id: row.id,
      });
    }

    // FOLLOW_UP: in progress, no update in 3+ days, due soon
    const staleFollowUp = open.filter((t) =>
      t.status === "In Progress" &&
      (Date.now() - Date.parse(t.updated_at)) > 3 * 86400000 &&
      t.due_date && daysBetween(today, t.due_date) <= 5,
    );
    for (const t of staleFollowUp.slice(0, 5)) {
      const ownerName = t.assigned_to ? nameById.get(t.assigned_to) ?? "owner" : "owner";
      actions.push({
        kind: "FOLLOW_UP",
        priority: "medium",
        title: `Follow up on ${t.task_code}`,
        detail: `In progress with no update for 3+ days (due ${t.due_date}). Check in with ${ownerName}.`,
        target_work_item_id: t.id,
      });
    }

    // APPROVE: aging approvals where caller is the approver
    for (const a of queue.filter((q) => q.state !== "pending").slice(0, 5)) {
      const step = stepByKey.get(`${(reqs.find((r) => r.id === a.request_id)?.chain_id) ?? ""}:${(reqs.find((r) => r.id === a.request_id)?.current_step) ?? 1}`);
      let mine = false;
      if (step?.approver_mode === "user" && step.approver_user_id === userId) mine = true;
      else if (step?.approver_mode === "role" && step.approver_role && roleSet.has(step.approver_role)) mine = true;
      else if (step?.approver_mode === "reviewer_field") {
        const t = taskById.get(a.work_item_id);
        if (t && t.reviewer === userId) mine = true;
      }
      if (!mine) continue;
      actions.push({
        kind: "APPROVE",
        priority: a.state === "escalated" ? "high" : "medium",
        title: `Approve ${a.work_item_code}`,
        detail: `Waiting ${Math.round(a.age_hours)}h on step "${a.step_name}".`,
        target_request_id: a.request_id,
        target_work_item_id: a.work_item_id,
      });
    }

    actions.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "high" ? -1 : b.priority === "high" ? 1 : a.priority === "medium" ? -1 : 1));

    return {
      meta: {
        scope: isAdmin ? "admin" : myTeamId ? "team" : "reports",
        user_id: userId,
        today,
        generated_at: new Date().toISOString(),
        capacity_hours: capacity,
        team_size: profiles.length,
      },
      kpis: {
        health_score, completion_pct, blocked_pct, carry_forward_pct,
        approval_turnaround_hours,
        team_size: profiles.length,
        total_open: open.length,
      },
      capacity: capRows,
      at_risk: {
        blocked: blockedRows.sort((a, b) => (b.blocked_age_days ?? 0) - (a.blocked_age_days ?? 0)).slice(0, 20),
        delayed: delayedRows.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).slice(0, 20),
        high_risk: highRiskRows.slice(0, 20),
        repeat_cf: repeatCfRows.sort((a, b) => b.carry_forward_count - a.carry_forward_count).slice(0, 20),
      },
      actions: actions.slice(0, 15),
      projects: projectRows.slice(0, 20),
      approvals: { pending: queue.slice(0, 30), counts: apprCounts },
    };
  });

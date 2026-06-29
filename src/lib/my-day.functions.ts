import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * My Day intelligence (E1).
 *
 * Deterministic priority scoring + per-section rollups for the current user.
 * One round-trip: parallel reads scoped by RLS to the caller, then in-memory
 * scoring/aggregation. No new SQL functions or migrations.
 *
 * Score formula (higher = do first):
 *   priority         High=40  Medium=20  Low=10
 *   due_today        +25
 *   due_tomorrow     +12
 *   due_this_week    +5
 *   overdue          +min(40, days_overdue * 8)
 *   risk_open        critical=30 high=20 medium=10 low=5  (max across events)
 *   carry_forward    +min(30, count * 6)
 *   approval_waiting +15  (user is approver on a pending request)
 *   reviewer         +12  (user is reviewer on the item)
 *   in_progress      +6
 *   blocked          -12  (still visible, but pushed down)
 */

export interface MyDayItem {
  id: string;
  task_code: string;
  task_name: string;
  project_name: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  planned_hours: number;
  carry_forward_count: number;
  is_overdue: boolean;
  is_blocked: boolean;
  risk_severity: "low" | "medium" | "high" | "critical" | null;
  has_pending_approval: boolean;
  is_reviewer: boolean;
  score: number;
  reasons: string[];
}

export interface MyDayPayload {
  meta: {
    user_id: string;
    today: string;
    capacity_hours: number;
    generated_at: string;
  };
  priorities: MyDayItem[];          // section 1+2: full ranked list (top 25)
  risks: {
    overdue: MyDayItem[];
    at_risk: MyDayItem[];
    high_severity: MyDayItem[];
    approval_waiting: MyDayItem[];
  };
  workload: {
    planned_hours: number;
    capacity_hours: number;
    remaining_hours: number;
    completed_today: number;
    open_today: number;
  };
  approvals_pending: Array<{
    request_id: string;
    work_item_id: string;
    work_item_code: string;
    work_item_name: string;
    step_name: string;
    requested_at: string;
  }>;
  carry_forward: {
    today: MyDayItem[];
    repeated: MyDayItem[];  // count > 3
  };
  eod_preview: {
    expected_completion_pct: number;
    expected_done: number;
    open_today: number;
  };
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export const getMyDay = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyDayPayload> => {
    const { supabase, userId } = context;
    const today = todayISO();
    const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return isoDate(d); })();
    const weekEnd = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return isoDate(d); })();

    // Parallel reads
    const [tasksRes, settingsRes, riskRes, apprReqRes, apprStepsRes] = await Promise.all([
      // Open tasks assigned to me OR where I am the reviewer
      supabase
        .from("tasks")
        .select("id,task_code,task_name,project_name,status,priority,due_date,planned_hours,carry_forward_count,assigned_to,reviewer,last_carry_forward_at,completed_at")
        .or(`assigned_to.eq.${userId},reviewer.eq.${userId}`)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(400),
      supabase.from("work_settings").select("daily_capacity_hours").eq("id", 1).maybeSingle(),
      supabase
        .from("risk_events")
        .select("entity_id,severity,kind,summary")
        .eq("entity_type", "task")
        .is("resolved_at", null),
      supabase
        .from("approval_requests")
        .select("id,work_item_id,current_step,chain_id,requested_at,status")
        .eq("status", "pending"),
      supabase
        .from("approval_steps")
        .select("chain_id,step_order,name,approver_mode,approver_user_id,approver_role"),
    ]);

    const allTasks = (tasksRes.data ?? []) as Array<{
      id: string; task_code: string; task_name: string; project_name: string | null;
      status: string; priority: string; due_date: string | null;
      planned_hours: number | null; carry_forward_count: number;
      assigned_to: string | null; reviewer: string | null;
      last_carry_forward_at: string | null; completed_at: string | null;
    }>;
    const capacity = Number(settingsRes.data?.daily_capacity_hours ?? 8);

    // Risk severity (worst) per task
    const SEV_RANK = { low: 1, medium: 2, high: 3, critical: 4 } as const;
    const riskByTask = new Map<string, keyof typeof SEV_RANK>();
    for (const r of (riskRes.data ?? []) as Array<{ entity_id: string; severity: string }>) {
      const sev = (r.severity as keyof typeof SEV_RANK);
      const cur = riskByTask.get(r.entity_id);
      if (!cur || SEV_RANK[sev] > SEV_RANK[cur]) riskByTask.set(r.entity_id, sev);
    }

    // Determine which pending approvals require *me*
    const allReqs = (apprReqRes.data ?? []) as Array<{ id: string; work_item_id: string; current_step: number; chain_id: string; requested_at: string }>;
    const allSteps = (apprStepsRes.data ?? []) as Array<{ chain_id: string; step_order: number; name: string; approver_mode: string; approver_user_id: string | null; approver_role: string | null }>;
    const stepByKey = new Map<string, typeof allSteps[number]>();
    for (const s of allSteps) stepByKey.set(`${s.chain_id}:${s.step_order}`, s);

    // Caller's roles (for role-mode steps)
    const { data: rolesRows } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const myRoles = new Set((rolesRows ?? []).map((r: { role: string }) => r.role));

    const approvalsForMe: MyDayPayload["approvals_pending"] = [];
    const tasksWithPendingApproval = new Set<string>();
    for (const req of allReqs) {
      const step = stepByKey.get(`${req.chain_id}:${req.current_step}`);
      if (!step) continue;
      let mine = false;
      if (step.approver_mode === "user" && step.approver_user_id === userId) mine = true;
      else if (step.approver_mode === "role" && step.approver_role && myRoles.has(step.approver_role)) mine = true;
      else if (step.approver_mode === "reviewer_field") {
        // Item-level: reviewer column on the work item.
        const t = allTasks.find((x) => x.id === req.work_item_id);
        if (t && t.reviewer === userId) mine = true;
      }
      if (!mine) continue;
      tasksWithPendingApproval.add(req.work_item_id);
      const t = allTasks.find((x) => x.id === req.work_item_id);
      approvalsForMe.push({
        request_id: req.id,
        work_item_id: req.work_item_id,
        work_item_code: t?.task_code ?? req.work_item_id.slice(0, 8),
        work_item_name: t?.task_name ?? "(work item)",
        step_name: step.name,
        requested_at: req.requested_at,
      });
    }

    // Score each open item assigned to me (not completed)
    const items: MyDayItem[] = [];
    let completed_today = 0;
    for (const t of allTasks) {
      const isMine = t.assigned_to === userId;
      const isReviewer = t.reviewer === userId;
      if (!isMine && !isReviewer) continue;
      if (t.status === "Completed") {
        if (t.completed_at && t.completed_at.slice(0, 10) === today) completed_today += 1;
        continue;
      }

      const reasons: string[] = [];
      let score = 0;

      // Priority
      const pBonus = t.priority === "High" ? 40 : t.priority === "Medium" ? 20 : 10;
      score += pBonus; reasons.push(`${t.priority} priority`);

      // Due-date pressure
      const due = t.due_date;
      let isOverdue = false;
      if (due) {
        if (due < today) {
          const days = Math.max(1, Math.floor((Date.parse(today) - Date.parse(due)) / 86400000));
          const od = Math.min(40, days * 8);
          score += od; reasons.push(`${days}d overdue`); isOverdue = true;
        } else if (due === today) { score += 25; reasons.push("Due today"); }
        else if (due === tomorrow) { score += 12; reasons.push("Due tomorrow"); }
        else if (due <= weekEnd) { score += 5; }
      }

      // Risk
      const sev = riskByTask.get(t.id) ?? null;
      if (sev) {
        const rb = sev === "critical" ? 30 : sev === "high" ? 20 : sev === "medium" ? 10 : 5;
        score += rb; reasons.push(`${sev} risk`);
      }

      // Carry-forward
      if (t.carry_forward_count > 0) {
        const cb = Math.min(30, t.carry_forward_count * 6);
        score += cb; reasons.push(`Carried ${t.carry_forward_count}x`);
      }

      // Approval waiting
      const hasAppr = tasksWithPendingApproval.has(t.id);
      if (hasAppr) { score += 15; reasons.push("Approval pending"); }

      // Reviewer assignment
      if (isReviewer && !isMine) { score += 12; reasons.push("You're the reviewer"); }

      // Status hints
      if (t.status === "In Progress") { score += 6; }
      const isBlocked = t.status === "Blocked";
      if (isBlocked) { score -= 12; reasons.push("Blocked"); }

      items.push({
        id: t.id,
        task_code: t.task_code,
        task_name: t.task_name,
        project_name: t.project_name,
        status: t.status,
        priority: t.priority,
        due_date: due,
        planned_hours: Number(t.planned_hours ?? 0),
        carry_forward_count: t.carry_forward_count,
        is_overdue: isOverdue,
        is_blocked: isBlocked,
        risk_severity: sev,
        has_pending_approval: hasAppr,
        is_reviewer: isReviewer && !isMine,
        score,
        reasons,
      });
    }

    items.sort((a, b) => b.score - a.score);
    const priorities = items.slice(0, 25);

    // Risk buckets
    const overdue = items.filter((i) => i.is_overdue);
    const at_risk = items.filter((i) => !i.is_overdue && (i.risk_severity === "medium" || i.due_date === today || i.due_date === tomorrow));
    const high_severity = items.filter((i) => i.risk_severity === "high" || i.risk_severity === "critical");
    const approval_waiting = items.filter((i) => i.has_pending_approval);

    // Workload (today): items due today or overdue, not blocked
    const todayItems = items.filter((i) => (i.due_date && i.due_date <= today) && !i.is_blocked);
    const planned_hours = todayItems.reduce((acc, i) => acc + (i.planned_hours || 0), 0);
    const remaining_hours = Math.max(0, capacity - planned_hours);

    // Carry forward
    const cf_today = items.filter((i) => i.carry_forward_count > 0);  // visible carried items
    const cf_repeated = items.filter((i) => i.carry_forward_count > 3);

    // EOD preview: assume items due-today with planned <= remaining capacity get done
    const open_today = todayItems.length;
    let cap = capacity;
    let expected_done = 0;
    for (const i of todayItems.sort((a, b) => b.score - a.score)) {
      const ph = i.planned_hours || 1;
      if (cap - ph >= -0.5) { cap -= ph; expected_done += 1; }
    }
    const expected_completion_pct = open_today === 0 ? 100 : Math.round((expected_done / open_today) * 100);

    return {
      meta: { user_id: userId, today, capacity_hours: capacity, generated_at: new Date().toISOString() },
      priorities,
      risks: {
        overdue: overdue.slice(0, 10),
        at_risk: at_risk.slice(0, 10),
        high_severity: high_severity.slice(0, 10),
        approval_waiting: approval_waiting.slice(0, 10),
      },
      workload: {
        planned_hours: Math.round(planned_hours * 10) / 10,
        capacity_hours: capacity,
        remaining_hours: Math.round(remaining_hours * 10) / 10,
        completed_today,
        open_today,
      },
      approvals_pending: approvalsForMe.slice(0, 20),
      carry_forward: {
        today: cf_today.slice(0, 15),
        repeated: cf_repeated.slice(0, 15),
      },
      eod_preview: {
        expected_completion_pct,
        expected_done,
        open_today,
      },
    };
  });

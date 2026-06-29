import type { Task, WorkloadSnapshot } from "@/lib/types";
import { isOverdue, todayISO } from "@/lib/format";
import {
  upsertWorkloadSnapshotsFn,
  last7DaysWorkloadFn,
} from "./workload.functions";

export interface UserUtil {
  user_id: string;
  planned_hours: number;
  actual_hours: number;
  active: number;
  delayed: number;
  blocked: number;
  completed: number;
}

export const workloadService = {
  /** Aggregate today's load per user from the live tasks table. */
  computeToday(tasks: Task[]): Map<string, UserUtil> {
    const m = new Map<string, UserUtil>();
    for (const t of tasks) {
      if (!t.assigned_to) continue;
      const u =
        m.get(t.assigned_to) ??
        { user_id: t.assigned_to, planned_hours: 0, actual_hours: 0, active: 0, delayed: 0, blocked: 0, completed: 0 };
      const planned = Number(t.planned_hours ?? 0);
      const actual = Number(t.actual_hours ?? 0);
      u.actual_hours += actual;
      if (t.status === "Completed") {
        u.completed += 1;
      } else {
        u.active += 1;
        u.planned_hours += planned;
        if (t.status === "Blocked") u.blocked += 1;
        if (isOverdue(t.due_date, t.status)) u.delayed += 1;
      }
      m.set(t.assigned_to, u);
    }
    return m;
  },

  /** Persist today's snapshot for every user (manager only). */
  async snapshotToday(tasks: Task[]) {
    const utils = this.computeToday(tasks);
    const date = todayISO();
    const rows = Array.from(utils.values()).map((u) => ({
      user_id: u.user_id,
      snapshot_date: date,
      planned_hours: u.planned_hours,
      actual_hours: u.actual_hours,
      active_count: u.active,
      delayed_count: u.delayed,
      blocked_count: u.blocked,
      completed_count: u.completed,
    }));
    if (!rows.length) return 0;
    const r = await upsertWorkloadSnapshotsFn({ data: { rows } });
    return r.inserted;
  },

  async last7Days(): Promise<WorkloadSnapshot[]> {
    return (await last7DaysWorkloadFn()) as WorkloadSnapshot[];
  },
};

/** Tone helper for heatmap colors. */
export function utilTone(plannedHours: number, capacity = 8) {
  const pct = plannedHours / capacity;
  if (pct < 0.4) return { label: "Under", className: "bg-status-progress/15 text-status-progress border-status-progress/30" };
  if (pct <= 0.9) return { label: "Balanced", className: "bg-status-completed/15 text-status-completed border-status-completed/30" };
  if (pct <= 1.1) return { label: "Near limit", className: "bg-priority-medium/15 text-priority-medium border-priority-medium/30" };
  return { label: "Overloaded", className: "bg-priority-high/15 text-priority-high border-priority-high/30" };
}

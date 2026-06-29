import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityBadge } from "@/components/PriorityBadge";
import { CapacityBar } from "@/components/CapacityBar";
import { formatDate, isOverdue, daysSince } from "@/lib/format";
import type { Profile, Task } from "@/lib/types";
import { AlertOctagon, CheckCircle2, Clock, ListChecks, TrendingUp } from "lucide-react";
import { TaskEodReviewCard } from "@/components/TaskEodReviewCard";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    const load = async () => {
      const [{ data: t }, { data: p }] = await Promise.all([
        supabase.from("tasks").select("*"),
        supabase.from("profiles").select("id,display_name,avatar_url"),
      ]);
      setTasks((t ?? []) as Task[]);
      setProfiles((p ?? []) as Profile[]);
    };
    load();
    const ch = supabase.channel("dash").on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const stats = useMemo(() => {
    const active = tasks.filter((t) => !["Completed"].includes(t.status));
    const completedToday = tasks.filter((t) => t.completed_at && new Date(t.completed_at).toDateString() === new Date().toDateString());
    const blocked = tasks.filter((t) => t.status === "Blocked");
    const overdue = tasks.filter((t) => isOverdue(t.due_date, t.status));
    return { total: tasks.length, active: active.length, completedToday: completedToday.length, blocked: blocked.length, overdue: overdue.length };
  }, [tasks]);

  const workload = useMemo(() => profiles.map((p) => {
    const own = tasks.filter((t) => t.assigned_to === p.id);
    return {
      profile: p,
      active: own.filter((t) => t.status !== "Completed").length,
      planned: own.filter((t) => t.status !== "Completed").reduce((s, t) => s + Number(t.planned_hours ?? 0), 0),
      actual: own.reduce((s, t) => s + Number(t.actual_hours ?? 0), 0),
      delayed: own.filter((t) => isOverdue(t.due_date, t.status)).length,
      blocked: own.filter((t) => t.status === "Blocked").length,
    };
  }).sort((a, b) => b.active - a.active), [tasks, profiles]);

  const highPriorityDelays = tasks.filter((t) => t.priority === "High" && isOverdue(t.due_date, t.status));
  const blockers = tasks.filter((t) => t.status === "Blocked");

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-4 py-4 space-y-5">
      <h1 className="text-xl font-semibold">Manager dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Tile icon={<ListChecks className="h-4 w-4" />} label="Total" value={stats.total} />
        <Tile icon={<TrendingUp className="h-4 w-4 text-status-progress" />} label="Active" value={stats.active} />
        <Tile icon={<CheckCircle2 className="h-4 w-4 text-status-completed" />} label="Done today" value={stats.completedToday} />
        <Tile icon={<AlertOctagon className="h-4 w-4 text-status-blocked" />} label="Blocked" value={stats.blocked} tone="text-status-blocked" />
        <Tile icon={<Clock className="h-4 w-4 text-priority-high" />} label="Overdue" value={stats.overdue} tone="text-priority-high" />
      </div>

      <Card className="p-3">
        <h2 className="text-sm font-semibold mb-3">Team workload</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr><th className="text-left py-2 font-medium">Member</th><th className="text-left font-medium">Active</th><th className="text-left font-medium hidden md:table-cell">Delayed</th><th className="text-left font-medium hidden md:table-cell">Blocked</th><th className="text-left font-medium min-w-[140px]">Capacity</th></tr>
            </thead>
            <tbody>
              {workload.map((w) => (
                <tr key={w.profile.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2">{w.profile.display_name}</td>
                  <td>{w.active}</td>
                  <td className="hidden md:table-cell">{w.delayed > 0 ? <span className="text-priority-high">{w.delayed}</span> : 0}</td>
                  <td className="hidden md:table-cell">{w.blocked > 0 ? <span className="text-status-blocked">{w.blocked}</span> : 0}</td>
                  <td className="py-2"><CapacityBar planned={w.planned} actual={w.actual} /></td>
                </tr>
              ))}
              {workload.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-xs text-muted-foreground italic">No team members yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <TaskEodReviewCard />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        <Card className="p-3">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><Clock className="h-4 w-4 text-priority-high" /> High-priority delays</h2>
          {highPriorityDelays.length === 0 ? <p className="text-xs text-muted-foreground italic">None — nice.</p> : (
            <ul className="space-y-2">
              {highPriorityDelays.map((t) => (
                <li key={t.id} className="text-sm flex items-center justify-between gap-2 border-b border-border/40 pb-2 last:border-0">
                  <div className="min-w-0">
                    <Link to="/tasks" className="font-medium truncate block hover:text-primary">{t.task_code} · {t.task_name}</Link>
                    <div className="text-xs text-muted-foreground">{profiles.find((p) => p.id === t.assigned_to)?.display_name ?? "Unassigned"} · due {formatDate(t.due_date)}</div>
                  </div>
                  <PriorityBadge priority={t.priority} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-3">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2"><AlertOctagon className="h-4 w-4 text-status-blocked" /> Active blockers</h2>
          {blockers.length === 0 ? <p className="text-xs text-muted-foreground italic">No blockers.</p> : (
            <ul className="space-y-2">
              {blockers.map((t) => (
                <li key={t.id} className="text-sm border-b border-border/40 pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{t.task_code}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="text-xs text-muted-foreground">{profiles.find((p) => p.id === t.assigned_to)?.display_name ?? "Unassigned"} · {daysSince(t.blocked_at)}d</div>
                  {t.blocker_reason && <p className="text-xs mt-1 text-status-blocked">{t.blocker_reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Tile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone?: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
    </Card>
  );
}

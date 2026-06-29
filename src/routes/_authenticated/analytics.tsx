import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import type { Task, WorkloadSnapshot, CarryForwardEvent } from "@/lib/types";
import { TrendingUp, AlertOctagon, ArrowRightCircle, Clock, CheckCircle2, Users, Eye } from "lucide-react";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: AnalyticsPage,
});

interface DailyPoint { date: string; value: number }

function daysAgo(n: number): string[] {
  const a: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    a.push(d.toISOString().slice(0, 10));
  }
  return a;
}

function AnalyticsPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [snaps, setSnaps] = useState<WorkloadSnapshot[]>([]);
  const [carries, setCarries] = useState<CarryForwardEvent[]>([]);

  useEffect(() => {
    (async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const sinceISO = since.toISOString().slice(0, 10);
      const [{ data: t }, { data: s }, { data: cf }] = await Promise.all([
        supabase.from("tasks").select("*"),
        supabase.from("daily_workload_snapshot").select("*").gte("snapshot_date", sinceISO),
        supabase.from("carry_forward_events").select("*").gte("created_at", since.toISOString()),
      ]);
      setTasks((t ?? []) as Task[]);
      setSnaps((s ?? []) as WorkloadSnapshot[]);
      setCarries((cf ?? []) as CarryForwardEvent[]);
    })();
  }, []);

  const days = useMemo(() => daysAgo(14), []);

  const completionTrend: DailyPoint[] = useMemo(
    () => days.map((d) => ({
      date: d,
      value: tasks.filter((t) => t.completed_at && t.completed_at.slice(0, 10) === d).length,
    })),
    [days, tasks],
  );

  const carryTrend: DailyPoint[] = useMemo(
    () => days.map((d) => ({ date: d, value: carries.filter((c) => c.created_at.slice(0, 10) === d).length })),
    [days, carries],
  );

  const utilTrend: DailyPoint[] = useMemo(
    () => days.map((d) => {
      const rows = snaps.filter((s) => s.snapshot_date === d);
      if (!rows.length) return { date: d, value: 0 };
      const avg = rows.reduce((s, r) => s + Number(r.planned_hours), 0) / rows.length;
      return { date: d, value: Math.round(avg * 10) / 10 };
    }),
    [days, snaps],
  );

  const delayTrend: DailyPoint[] = useMemo(
    () => days.map((d) => ({
      date: d,
      value: snaps.filter((s) => s.snapshot_date === d).reduce((s, r) => s + r.delayed_count, 0),
    })),
    [days, snaps],
  );

  const blockerTrend: DailyPoint[] = useMemo(
    () => days.map((d) => ({
      date: d,
      value: snaps.filter((s) => s.snapshot_date === d).reduce((s, r) => s + r.blocked_count, 0),
    })),
    [days, snaps],
  );

  const reviewerBottleneck = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      if (t.status === "In Review" && t.reviewer) m.set(t.reviewer, (m.get(t.reviewer) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  const plannedVsActual = useMemo(() => {
    const planned = snaps.reduce((s, r) => s + Number(r.planned_hours), 0);
    const actual = snaps.reduce((s, r) => s + Number(r.actual_hours), 0);
    return { planned, actual };
  }, [snaps]);

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Execution analytics</h1>
        <p className="text-xs text-muted-foreground">Last 14 days · trends across the team</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TrendCard icon={<CheckCircle2 className="h-4 w-4 text-status-completed" />} title="Task completion" points={completionTrend} />
        <TrendCard icon={<ArrowRightCircle className="h-4 w-4 text-priority-medium" />} title="Carry-forwards" points={carryTrend} />
        <TrendCard icon={<TrendingUp className="h-4 w-4 text-status-progress" />} title="Avg planned hours / member" points={utilTrend} suffix="h" />
        <TrendCard icon={<Clock className="h-4 w-4 text-priority-high" />} title="Delayed tasks" points={delayTrend} />
        <TrendCard icon={<AlertOctagon className="h-4 w-4 text-status-blocked" />} title="Blockers" points={blockerTrend} />
        <Card className="p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Users className="h-4 w-4" /> Planned vs Actual (14d)</div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-2xl font-semibold">{plannedVsActual.planned}h</span>
            <span className="text-sm text-muted-foreground">planned</span>
            <span className="text-2xl font-semibold ml-auto">{plannedVsActual.actual}h</span>
            <span className="text-sm text-muted-foreground">actual</span>
          </div>
        </Card>
        <Card className="p-3 md:col-span-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Eye className="h-4 w-4" /> Reviewer bottleneck</div>
          {reviewerBottleneck.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground italic">No reviews pending.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {reviewerBottleneck.slice(0, 5).map(([rid, count]) => (
                <li key={rid} className="flex items-center justify-between border-b border-border/30 py-1 last:border-0">
                  <span className="text-muted-foreground text-xs">{rid.slice(0, 8)}…</span>
                  <span className="font-medium">{count} in review</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function TrendCard({ icon, title, points, suffix = "" }: { icon: React.ReactNode; title: string; points: DailyPoint[]; suffix?: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const last = points[points.length - 1]?.value ?? 0;
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon} {title}</div>
        <span className="text-lg font-semibold">{last}{suffix}</span>
      </div>
      <svg viewBox="0 0 200 50" className="mt-2 w-full h-12" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-primary"
          points={points.map((p, i) => `${(i / (points.length - 1 || 1)) * 200},${50 - (p.value / max) * 45 - 2}`).join(" ")}
        />
      </svg>
    </Card>
  );
}

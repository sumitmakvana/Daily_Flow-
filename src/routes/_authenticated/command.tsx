import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CapacityBar } from "@/components/CapacityBar";
import { RiskBadge } from "@/components/RiskBadge";
import { risksService, SEVERITY_RANK } from "@/services/risks";
import { workSettingsService } from "@/services/operations";
import { TomorrowRiskPanel } from "@/components/TomorrowRiskPanel";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import { workloadService } from "@/services/workload";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
import { isOverdue } from "@/lib/format";
import type { Profile, Task, RiskEvent, WorkSettings } from "@/lib/types";
import { Activity, AlertOctagon, CheckCircle2, RefreshCw, ShieldAlert, TrendingUp, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/command")({
  component: CommandPage,
});

function CommandPage() {
  const { user, isManager } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [risks, setRisks] = useState<RiskEvent[]>([]);
  const [settings, setSettings] = useState<WorkSettings | null>(null);
  const [detecting, setDetecting] = useState(false);

  const load = async () => {
    const [{ data: t }, { data: p }, r, s] = await Promise.all([
      supabase.from("tasks").select("*"),
      supabase.from("profiles").select("id,display_name,avatar_url"),
      risksService.listOpen(),
      workSettingsService.get(),
    ]);
    setTasks((t ?? []) as Task[]);
    setProfiles((p ?? []) as Profile[]);
    setRisks(r);
    setSettings(s);
  };
  useEffect(() => { load(); }, []);
  useRealtimeTasks(load, "command-rt");

  useEffect(() => {
    const ch = supabase
      .channel("risk-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "risk_events" }, () =>
        risksService.listOpen().then(setRisks),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const cap = settings?.daily_capacity_hours ?? 8;

  const kpis = useMemo(() => {
    const total = tasks.length || 1;
    const completed = tasks.filter((t) => t.status === "Completed").length;
    const blocked = tasks.filter((t) => t.status === "Blocked").length;
    const overdue = tasks.filter((t) => isOverdue(t.due_date, t.status)).length;
    const slaRisk = tasks.filter((t) => t.sla_due_at && new Date(t.sla_due_at) < new Date() && t.status !== "Completed").length;
    const util = workloadService.computeToday(tasks);
    const utilPct =
      profiles.length === 0
        ? 0
        : Array.from(util.values()).reduce((s, u) => s + u.planned_hours, 0) / (profiles.length * cap);
    return {
      completion: Math.round((completed / total) * 100),
      pending: Math.round(((total - completed - blocked) / total) * 100),
      blocked: Math.round((blocked / total) * 100),
      slaRisk: Math.round((slaRisk / total) * 100),
      utilization: Math.round(utilPct * 100),
      overdue,
    };
  }, [tasks, profiles, cap]);

  const workload = useMemo(() => {
    const m = workloadService.computeToday(tasks);
    return profiles.map((p) => ({
      profile: p,
      ...(m.get(p.id) ?? { planned_hours: 0, actual_hours: 0, active: 0, delayed: 0, blocked: 0, completed: 0 }),
    })).sort((a, b) => b.planned_hours - a.planned_hours);
  }, [tasks, profiles]);

  const topRisks = [...risks].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).slice(0, 10);

  const onResolve = async (id: string) => {
    if (!user) return;
    await risksService.resolve(id, user.id);
    toast.success("Risk resolved");
  };

  const onDetect = async () => {
    setDetecting(true);
    try {
      const ok = await risksService.detectNow();
      toast[ok ? "success" : "error"](ok ? "Detection complete" : "Detection failed");
      await risksService.listOpen().then(setRisks);
    } finally { setDetecting(false); }
  };

  if (!isManager) {
    return (
      <div className="max-w-md mx-auto px-3 py-12 text-center text-sm text-muted-foreground">
        Command Center is available to managers.
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" /> Command Center
        </h1>
        <Button size="sm" variant="outline" onClick={onDetect} disabled={detecting}>
          <RefreshCw className={"h-3.5 w-3.5 mr-1.5 " + (detecting ? "animate-spin" : "")} />
          Re-run risk scan
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Kpi icon={<CheckCircle2 className="h-3.5 w-3.5 text-status-completed" />} label="Completion" value={`${kpis.completion}%`} />
        <Kpi icon={<TrendingUp className="h-3.5 w-3.5" />} label="Pending" value={`${kpis.pending}%`} />
        <Kpi icon={<AlertOctagon className="h-3.5 w-3.5 text-status-blocked" />} label="Blocked" value={`${kpis.blocked}%`} />
        <Kpi icon={<ShieldAlert className="h-3.5 w-3.5 text-priority-high" />} label="SLA risk" value={`${kpis.slaRisk}%`} />
        <Kpi icon={<Activity className="h-3.5 w-3.5 text-primary" />} label="Utilization" value={`${kpis.utilization}%`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="p-3 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <ShieldAlert className="h-4 w-4 text-priority-high" /> Top operational risks
            </h2>
            <Badge variant="outline" className="text-[10px]">{risks.length} open</Badge>
          </div>
          {topRisks.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-6 text-center">
              No risks detected. Daily scan runs at 07:00.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {topRisks.map((r) => (
                <li key={r.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <RiskBadge risk={r} />
                      <span className="text-xs text-muted-foreground capitalize">{r.severity}</span>
                    </div>
                    <p className="text-sm truncate">{r.summary}</p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onResolve(r.id)}>
                    Resolve
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-3">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Users className="h-4 w-4" /> Team capacity today
          </h2>
          <ul className="space-y-2">
            {workload.slice(0, 8).map((w) => {
              const pct = (w.planned_hours / cap) * 100;
              const overload = pct > 110;
              return (
                <li key={w.profile.id}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="truncate font-medium">{w.profile.display_name}</span>
                    <span className={overload ? "text-priority-high font-medium" : "text-muted-foreground"}>
                      {Math.round(pct)}%
                    </span>
                  </div>
                  <CapacityBar planned={w.planned_hours} actual={w.actual_hours} capacity={cap} />
                </li>
              );
            })}
            {workload.length === 0 && <li className="text-xs text-muted-foreground italic">No team activity.</li>}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TomorrowRiskPanel tasks={tasks} />
        <SuggestionsPanel profiles={profiles} tasks={tasks} />
      </div>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon} {label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
}

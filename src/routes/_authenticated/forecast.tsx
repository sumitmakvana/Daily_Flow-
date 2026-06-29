import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getForecast, type ForecastPayload } from "@/lib/forecast.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle, TrendingUp, Lightbulb, Wrench, Users, Clock, Folder, Activity, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/forecast")({
  component: ForecastPage,
});

const bandClass: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/40 dark:text-orange-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200",
  low: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200",
};

const zoneClass: Record<string, string> = {
  red: "bg-red-500", amber: "bg-amber-500", green: "bg-emerald-500", blue: "bg-sky-500",
};

const outlookLabel: Record<string, { label: string; cls: string }> = {
  likely_slip: { label: "Likely to slip", cls: "text-red-700" },
  at_risk: { label: "At risk", cls: "text-amber-700" },
  on_track: { label: "On track", cls: "text-emerald-700" },
};

function ForecastPage() {
  const fetchForecast = useServerFn(getForecast);
  const [data, setData] = useState<ForecastPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchForecast()
      .then((d) => { if (!cancelled) setData(d); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchForecast]);

  if (loading || !data) {
    return (
      <div className="max-w-5xl mx-auto px-3 md:px-4 py-10 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Computing forecast…
      </div>
    );
  }

  const { meta, sla, workload, approvals, projects, insights, validation } = data;

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-4 py-4 space-y-5">
      <header className="flex items-end justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Operational Forecast
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {meta.horizon_days}-day outlook · scope: {meta.scope} · {meta.team_size} people
          </p>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Back-test (last 30d): precision {validation.sla_precision == null ? "—" : `${Math.round(validation.sla_precision * 100)}%`}
          {" "}· recall {validation.sla_recall == null ? "—" : `${Math.round(validation.sla_recall * 100)}%`}
          {" "}· n={validation.sample_size}
        </div>
      </header>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="p-3">
          <div className="text-[11px] text-muted-foreground">SLA at risk (high+)</div>
          <div className="text-2xl font-semibold text-red-600">{sla.counts.critical + sla.counts.high}</div>
          <div className="text-[10px] text-muted-foreground">crit {sla.counts.critical} · high {sla.counts.high}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] text-muted-foreground">Overloaded ({meta.horizon_days}d)</div>
          <div className="text-2xl font-semibold text-amber-600">{workload.overloaded}</div>
          <div className="text-[10px] text-muted-foreground">red+amber zones</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] text-muted-foreground">Approvals projected to breach</div>
          <div className="text-2xl font-semibold text-orange-600">
            {approvals.forecast.filter((a) => a.state === "will_breach").length}
          </div>
          <div className="text-[10px] text-muted-foreground">
            median turnaround {approvals.median_turnaround_hours ?? "—"}h
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] text-muted-foreground">Projects likely to slip</div>
          <div className="text-2xl font-semibold text-red-600">
            {projects.filter((p) => p.outlook === "likely_slip").length}
          </div>
          <div className="text-[10px] text-muted-foreground">of {projects.length} tracked</div>
        </Card>
      </div>

      {/* Insights */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <InsightColumn title="Top Risks" icon={<AlertTriangle className="h-4 w-4 text-red-600" />} rows={insights.risks} emptyText="No major risks predicted." tone="risk" />
        <InsightColumn title="Top Opportunities" icon={<Lightbulb className="h-4 w-4 text-amber-600" />} rows={insights.opportunities} emptyText="No spare capacity right now." tone="opp" />
        <InsightColumn title="Required Actions" icon={<Wrench className="h-4 w-4 text-blue-600" />} rows={insights.actions} emptyText="Nothing needs your attention." tone="act" />
      </section>

      {/* SLA forecast */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Clock className="h-4 w-4" /> SLA Forecast — top {Math.min(15, sla.rows.length)}</h2>
        <Card className="divide-y divide-border">
          {sla.rows.slice(0, 15).map((r) => (
            <div key={r.task_id} className="px-3 py-2 flex items-center gap-3 min-h-14">
              <Badge variant="outline" className={cn("text-[10px] capitalize", bandClass[r.breach_band])}>
                {r.breach_band} · {r.breach_score}
              </Badge>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{r.task_code} · {r.task_name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {r.owner_name ?? "Unassigned"} · {r.due_date ?? "no due"} {r.days_to_due != null && `(${r.days_to_due >= 0 ? "in " + r.days_to_due + "d" : Math.abs(r.days_to_due) + "d overdue"})`}
                  {r.reasons.length > 0 && <> · {r.reasons.slice(0, 3).join(", ")}</>}
                </div>
              </div>
            </div>
          ))}
          {sla.rows.length === 0 && <p className="text-xs text-muted-foreground italic p-3">No open work to forecast.</p>}
        </Card>
      </section>

      {/* Workload forecast */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Users className="h-4 w-4" /> Workload Forecast ({meta.horizon_days}d)</h2>
        <Card className="divide-y divide-border">
          {workload.rows.map((w) => (
            <div key={w.user_id} className="px-3 py-2.5 min-h-14">
              <div className="flex items-center gap-3">
                <span className={cn("h-2 w-2 rounded-full shrink-0", zoneClass[w.zone])} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{w.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {w.projected_hours}h / {w.capacity_window}h · peak {w.bottleneck_day_hours}h on {w.bottleneck_day ?? "—"}
                  </div>
                </div>
                <span className="text-sm font-semibold tabular-nums">{w.load_pct}%</span>
              </div>
              <Progress value={Math.min(150, w.load_pct)} className="h-1.5 mt-1.5" />
            </div>
          ))}
        </Card>
        {workload.bottleneck_dates.length > 0 && (
          <div className="text-[11px] text-muted-foreground">
            Bottleneck days: {workload.bottleneck_dates.map((d) => `${d.date} (${d.total_hours}h)`).join(" · ")}
          </div>
        )}
      </section>

      {/* Approval forecast */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Approval Forecast</h2>
        <Card className="divide-y divide-border">
          {approvals.forecast.length === 0 && <p className="text-xs text-muted-foreground italic p-3">No pending approvals.</p>}
          {approvals.forecast.slice(0, 10).map((a) => (
            <div key={a.request_id} className="px-3 py-2 flex items-center gap-3 min-h-12">
              <Badge variant="outline" className={cn("text-[10px]",
                a.state === "will_breach" ? bandClass.high :
                a.state === "at_risk" ? bandClass.medium :
                bandClass.low)}>
                {a.state.replace("_", " ")}
              </Badge>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{a.work_item_code}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {a.approver_label} · {a.age_hours}h waited · projected {a.projected_total_hours}h
                </div>
              </div>
            </div>
          ))}
        </Card>
        {approvals.bottlenecks.length > 0 && (
          <Card className="p-3">
            <div className="text-[11px] font-semibold text-muted-foreground mb-1.5">Approver bottlenecks</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {approvals.bottlenecks.map((b) => (
                <div key={b.approver_label} className="flex items-center gap-2 text-xs">
                  <Badge variant="secondary" className="text-[10px]">{b.pending}</Badge>
                  <span className="truncate flex-1">{b.approver_label}</span>
                  <span className="text-muted-foreground tabular-nums">med {b.median_age_hours}h · oldest {b.oldest_age_hours}h</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </section>

      {/* Project forecast */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Folder className="h-4 w-4" /> Project Forecast</h2>
        <Card className="divide-y divide-border">
          {projects.length === 0 && <p className="text-xs text-muted-foreground italic p-3">No projects with open work.</p>}
          {projects.map((p) => (
            <div key={p.project_id} className="px-3 py-2 flex items-center gap-3 min-h-12">
              <div className={cn("text-[10px] font-semibold uppercase w-24 shrink-0", outlookLabel[p.outlook].cls)}>
                {outlookLabel[p.outlook].label}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {p.open} open · {p.overdue} overdue · {p.high_risk_open} high-risk
                </div>
              </div>
              <span className="text-sm font-semibold tabular-nums">{p.slip_score}</span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}

function InsightColumn({
  title, icon, rows, emptyText, tone,
}: {
  title: string;
  icon: React.ReactNode;
  rows: { title: string; detail: string; severity: string }[];
  emptyText: string;
  tone: "risk" | "opp" | "act";
}) {
  const borderTone =
    tone === "risk" ? "border-l-red-400"
    : tone === "opp" ? "border-l-amber-400"
    : "border-l-blue-400";
  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">{icon} {title}</div>
      {rows.length === 0 && <p className="text-xs text-muted-foreground italic">{emptyText}</p>}
      {rows.map((r, i) => (
        <div key={i} className={cn("text-xs border-l-2 pl-2 py-1", borderTone)}>
          <div className="font-medium">{r.title}</div>
          <div className="text-muted-foreground">{r.detail}</div>
        </div>
      ))}
    </Card>
  );
}

import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AlertOctagon, AlertTriangle, Bot, CheckCircle2, ClipboardCheck, Gauge,
  ShieldAlert, Sparkles, TrendingDown, TrendingUp, Users, Activity, Building2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getExecSummary, getExecScope, type ExecSummary, type ExecScopeBootstrap } from "@/lib/executive.functions";

export const Route = createFileRoute("/_authenticated/executive")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    const set = new Set((roles ?? []).map((r) => r.role));
    if (!set.has("admin") && !set.has("manager")) {
      throw redirect({ to: "/today" });
    }
  },
  component: ExecutivePage,
});

type RangeKey = "1" | "7" | "14" | "30" | "90";
const RANGE_LABEL: Record<RangeKey, string> = { "1": "Today", "7": "7 days", "14": "14 days", "30": "30 days", "90": "90 days" };

/* ----- Scope (E0.1E) ----- */
type Scope =
  | { kind: "org" }
  | { kind: "team"; id: string }
  | { kind: "manager"; id: string };

const SCOPE_STORAGE_KEY = "exec.scope.v1";

function readStoredScope(): Scope | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SCOPE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (v?.kind === "org") return { kind: "org" };
    if ((v?.kind === "team" || v?.kind === "manager") && typeof v.id === "string") return v;
  } catch { /* ignore */ }
  return null;
}

function persistScope(s: Scope) {
  try { window.localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function deriveDefaultScope(boot: ExecScopeBootstrap): Scope {
  if (boot.primaryTeamId) return { kind: "team", id: boot.primaryTeamId };
  if (boot.isManager && !boot.isAdmin) return { kind: "manager", id: boot.userId };
  return { kind: "org" };
}

function scopeToFilters(s: Scope): { team: string | null; manager: string | null } {
  if (s.kind === "team") return { team: s.id, manager: null };
  if (s.kind === "manager") return { team: null, manager: s.id };
  return { team: null, manager: null };
}

function ExecutivePage() {
  const [range, setRange] = useState<RangeKey>("7");
  const [projectId, setProjectId] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [scope, setScopeState] = useState<Scope | null>(() => readStoredScope());

  const fetchBootstrap = useServerFn(getExecScope);
  const { data: boot } = useQuery({
    queryKey: ["exec-scope-bootstrap"],
    queryFn: () => fetchBootstrap(),
    staleTime: Infinity,
  });

  // First-load default when no persisted scope.
  useEffect(() => {
    if (scope || !boot) return;
    setScopeState(deriveDefaultScope(boot));
  }, [boot, scope]);

  const setScope = (next: Scope) => { setScopeState(next); persistScope(next); };

  const filters = scope ? scopeToFilters(scope) : null;
  const fetchSummary = useServerFn(getExecSummary);
  const { data: summary, isLoading, error } = useQuery({
    queryKey: ["exec-summary", range, scope, projectId, typeFilter],
    queryFn: () =>
      fetchSummary({
        data: {
          days: Number(range),
          team: filters!.team,
          manager: filters!.manager,
          project: projectId === "all" ? null : projectId,
          type: typeFilter === "all" ? null : typeFilter,
        },
      }),
    enabled: !!filters,
    staleTime: 30_000,
  });

  const scopeLabel = useMemo(() => {
    if (!scope || !boot) return "…";
    if (scope.kind === "org") return "Organization";
    if (scope.kind === "team") {
      if (scope.id === boot.primaryTeamId) return `My Team · ${boot.primaryTeamName ?? "—"}`;
      const t = summary?.filters.teams.find((x) => x.id === scope.id);
      return `Team · ${t?.name ?? "…"}`;
    }
    if (scope.id === boot.userId) return "My Hierarchy";
    const m = summary?.filters.managers.find((x) => x.id === scope.id);
    return `Manager · ${m?.name ?? "…"}`;
  }, [scope, boot, summary]);

  if (isLoading || !summary || !boot || !scope) {
    return (
      <div className="max-w-7xl mx-auto px-3 md:px-6 py-6 space-y-3">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-3 md:px-6 py-6">
        <Card className="p-4 border-priority-high/40">
          <div className="font-semibold text-priority-high mb-1">Failed to load Executive Command Center</div>
          <div className="text-sm text-muted-foreground">{(error as Error).message}</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-3 md:px-6 py-4 md:py-6 space-y-5">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-xl md:text-2xl font-semibold">Executive Command Center</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs md:text-sm text-muted-foreground">
            <Badge variant="secondary" className="gap-1 font-medium">
              <Building2 className="h-3 w-3" /> Scope: {scopeLabel}
            </Badge>
            <span>· {RANGE_LABEL[range]}</span>
            {summary.meta.visible_team_count > 0 && (
              <span className="hidden md:inline">· {summary.meta.visible_team_count} team(s) visible</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <ScopeSelect scope={scope} boot={boot} teams={summary.filters.teams} managers={summary.filters.managers} onChange={setScope} />
          <FilterSelect value={range} onChange={(v) => setRange(v as RangeKey)} label="Range"
            options={[["1", "Today"], ["7", "7d"], ["14", "14d"], ["30", "30d"], ["90", "90d"]]} />
          <FilterSelect value={projectId} onChange={setProjectId} label="Project"
            options={[["all", "All projects"], ...summary.filters.projects.map((p) => [p.id, p.name] as [string, string])]} />
          <FilterSelect value={typeFilter} onChange={setTypeFilter} label="Type"
            options={[["all", "All types"], ...summary.filters.types.map((t) => [t.id, t.name] as [string, string])]} />
        </div>
      </header>

      <ExecutionHealth s={summary} />
      <DeliveryHealth s={summary} />
      <RiskCenter s={summary} />
      <WorkloadBalance s={summary} />
      <ExecutionDiscipline s={summary} />
      <AutomationROI s={summary} />
      <AdoptionMetrics s={summary} />
      <TeamHealthSection s={summary} />
      <ManagerEffectivenessSection s={summary} />
      <ExecutiveInsights s={summary} />
    </div>
  );
}

/* ----- Scope picker ----- */

function scopeToValue(s: Scope): string {
  if (s.kind === "org") return "org";
  return `${s.kind}:${s.id}`;
}

function valueToScope(v: string): Scope {
  if (v === "org") return { kind: "org" };
  const [kind, id] = v.split(":");
  if (kind === "team") return { kind: "team", id };
  if (kind === "manager") return { kind: "manager", id };
  return { kind: "org" };
}

function ScopeSelect({ scope, boot, teams, managers, onChange }: {
  scope: Scope;
  boot: ExecScopeBootstrap;
  teams: Array<{ id: string; name: string }>;
  managers: Array<{ id: string; name: string }>;
  onChange: (s: Scope) => void;
}) {
  // Managers (non-admin) cannot pick organization; admins can pick anything.
  const canSeeOrg = boot.isAdmin;
  return (
    <Select value={scopeToValue(scope)} onValueChange={(v) => onChange(valueToScope(v))}>
      <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Scope" /></SelectTrigger>
      <SelectContent>
        {canSeeOrg && (
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wide">Scope</SelectLabel>
            <SelectItem value="org" className="text-xs">Organization</SelectItem>
          </SelectGroup>
        )}
        {teams.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wide">Teams</SelectLabel>
            {boot.primaryTeamId && (
              <SelectItem value={`team:${boot.primaryTeamId}`} className="text-xs">
                My Team · {boot.primaryTeamName ?? "—"}
              </SelectItem>
            )}
            {teams
              .filter((t) => t.id !== boot.primaryTeamId)
              .slice(0, 50)
              .map((t) => (
                <SelectItem key={t.id} value={`team:${t.id}`} className="text-xs">{t.name}</SelectItem>
              ))}
          </SelectGroup>
        )}
        {managers.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-[10px] uppercase tracking-wide">Managers</SelectLabel>
            {(boot.isManager || boot.isAdmin) && (
              <SelectItem value={`manager:${boot.userId}`} className="text-xs">My Hierarchy</SelectItem>
            )}
            {managers
              .filter((m) => m.id !== boot.userId)
              .slice(0, 50)
              .map((m) => (
                <SelectItem key={m.id} value={`manager:${m.id}`} className="text-xs">{m.name}</SelectItem>
              ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

/* ---------------- Shared primitives ---------------- */

function FilterSelect({ value, onChange, label, options }: {
  value: string; onChange: (v: string) => void; label: string; options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Section({ title, icon, children, action }: { title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {icon} {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, tone, to }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "warn" | "bad" | "neutral"; to?: string;
}) {
  const toneClass =
    tone === "good" ? "border-status-completed/40" :
    tone === "warn" ? "border-priority-medium/40" :
    tone === "bad" ? "border-priority-high/40" : "";
  const body = (
    <Card className={`p-3 md:p-4 h-full ${toneClass}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl md:text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

function toneForPct(pct: number): "good" | "warn" | "bad" {
  if (pct > 85) return "good";
  if (pct >= 70) return "warn";
  return "bad";
}

function StatusDot({ tone }: { tone: "good" | "warn" | "bad" }) {
  const c = tone === "good" ? "bg-status-completed" : tone === "warn" ? "bg-priority-medium" : "bg-priority-high";
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} />;
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" | "bad" }) {
  const c = tone === "bad" ? "text-priority-high" : tone === "warn" ? "text-priority-medium" : "";
  return <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className={`font-medium tabular-nums ${c}`}>{value}</span></div>;
}

/* ---------------- 1. Execution Health ---------------- */

function ExecutionHealth({ s }: { s: ExecSummary }) {
  const e = s.execution;
  const pct = e.planned_today ? Math.round((e.completed_today / e.planned_today) * 100) : 0;
  const cur = e.week_due ? Math.round((e.week_done / e.week_due) * 100) : 0;
  const prev = e.prev_week_due ? Math.round((e.prev_week_done / e.prev_week_due) * 100) : 0;
  const delta = cur - prev;
  return (
    <Section title="Execution Health" icon={<Activity className="h-4 w-4" />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <Kpi label="Planned today" value={e.planned_today} />
        <Kpi label="Completed today" value={e.completed_today} />
        <Kpi label="Completion %" value={`${pct}%`} tone={toneForPct(pct)} />
        <Kpi label="Week trend" value={`${cur}%`} tone={toneForPct(cur)}
          sub={<span className={delta >= 0 ? "text-status-completed" : "text-priority-high"}>
            {delta >= 0 ? <TrendingUp className="inline h-3 w-3" /> : <TrendingDown className="inline h-3 w-3" />} {delta >= 0 ? "+" : ""}{delta}% vs prev week ({prev}%)
          </span>} />
      </div>
    </Section>
  );
}

/* ---------------- 2. Delivery Health ---------------- */

function DeliveryHealth({ s }: { s: ExecSummary }) {
  const d = s.delivery;
  return (
    <Section title="Delivery Health" icon={<ClipboardCheck className="h-4 w-4" />}>
      <div className="grid grid-cols-3 gap-2 md:gap-3 mb-2">
        <Kpi label="On track" value={d.on_track} tone="good" />
        <Kpi label="At risk" value={d.at_risk} tone="warn" />
        <Kpi label="Delayed" value={d.delayed} tone="bad" />
      </div>
      {d.projects.length > 0 && (
        <Card className="p-3 divide-y">
          {d.projects.map((p) => (
            <Link key={p.id} to="/tasks" className="flex items-center justify-between gap-2 py-1.5 text-sm hover:bg-muted/30 rounded px-1">
              <span className="truncate min-w-0">{p.name}</span>
              <span className="flex items-center gap-2 shrink-0 text-xs">
                {p.overdue > 0 && <Badge variant="outline" className="border-priority-high/40 text-priority-high">{p.overdue} overdue</Badge>}
                {p.blocked > 0 && <Badge variant="outline" className="border-status-blocked/40">{p.blocked} blocked</Badge>}
                <StatusDot tone={p.status === "late" ? "bad" : p.status === "risk" ? "warn" : "good"} />
              </span>
            </Link>
          ))}
        </Card>
      )}
    </Section>
  );
}

/* ---------------- 3. Risk Center ---------------- */

function RiskCenter({ s }: { s: ExecSummary }) {
  const r = s.risk;
  return (
    <Section title="Risk Center" icon={<ShieldAlert className="h-4 w-4 text-priority-high" />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-2">
        <Kpi label="Blocked items" value={r.blocked} tone={r.blocked > 0 ? "bad" : "good"} to="/blockers" />
        <Kpi label="High-sev risks" value={r.high} tone={r.high > 0 ? "bad" : "good"} to="/command" />
        <Kpi label="SLA breaches" value={r.sla_breaches} tone={r.sla_breaches > 0 ? "bad" : "good"} />
        <Kpi label="Approvals pending" value={r.approvals_pending} tone={r.approvals_pending > 5 ? "warn" : "neutral"} />
      </div>
      {r.critical.length > 0 && (
        <Card className="p-3 divide-y">
          {r.critical.map((x) => (
            <Link key={x.id} to={x.entity_type === "task" ? "/tasks" : "/command"}
              className="flex items-start justify-between gap-2 py-1.5 text-sm hover:bg-muted/30 rounded px-1">
              <span className="min-w-0 truncate">{x.summary}</span>
              <Badge variant="outline" className={x.severity === "critical" ? "border-priority-high/60 text-priority-high" : "border-priority-medium/60 text-priority-medium"}>
                {x.severity}
              </Badge>
            </Link>
          ))}
        </Card>
      )}
    </Section>
  );
}

/* ---------------- 4. Workload Balance ---------------- */

function WorkloadBalance({ s }: { s: ExecSummary }) {
  const rows = s.workload.rows;
  const over = rows.filter((r) => r.pct > 120).length;
  const balanced = rows.filter((r) => r.pct >= 80 && r.pct <= 120).length;
  const under = rows.filter((r) => r.pct < 60).length;
  return (
    <Section title="Workload Balance" icon={<Users className="h-4 w-4" />}>
      <div className="grid grid-cols-3 gap-2 md:gap-3 mb-2">
        <Kpi label="Overloaded" value={over} tone={over > 0 ? "bad" : "good"} />
        <Kpi label="Balanced" value={balanced} tone="good" />
        <Kpi label="Underutilized" value={under} tone="neutral" />
      </div>
      {rows.length > 0 && (
        <Card className="p-3 divide-y">
          {rows.slice(0, 10).map((r) => {
            const tone = r.pct > 120 ? "text-priority-high" : r.pct >= 80 ? "text-status-completed" : "text-status-progress";
            return (
              <div key={r.user_id} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_120px_auto] items-center gap-2 py-1.5 text-sm">
                <div className="min-w-0 truncate font-medium">{r.name ?? "Unknown"}</div>
                <div className="hidden sm:block h-1.5 bg-muted rounded overflow-hidden">
                  <div className={`h-full ${r.pct > 120 ? "bg-priority-high" : r.pct >= 80 ? "bg-status-completed" : "bg-status-progress"}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                </div>
                <div className={`text-right text-xs font-semibold tabular-nums ${tone}`}>{r.pct}%</div>
              </div>
            );
          })}
        </Card>
      )}
    </Section>
  );
}

/* ---------------- 5. Execution Discipline ---------------- */

function ExecutionDiscipline({ s }: { s: ExecSummary }) {
  const d = s.discipline;
  const eodPct = d.eod_total_members ? Math.round((d.eod_today / d.eod_total_members) * 100) : 0;
  const max = Math.max(1, ...d.cf_trend.map((x) => x.n));
  return (
    <Section title="Execution Discipline" icon={<Gauge className="h-4 w-4" />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-2">
        <Kpi label="Carry-forward today" value={d.cf_today} tone={d.cf_today > 5 ? "warn" : "good"} />
        <Kpi label="Carry-forward >3x" value={d.cf_hot} tone={d.cf_hot > 0 ? "bad" : "good"} />
        <Kpi label="EOD compliance" value={`${eodPct}%`} tone={toneForPct(eodPct)} />
        <Kpi label="Blocked >3 days" value={d.blocked_3d} tone={d.blocked_3d > 0 ? "bad" : "good"} />
      </div>
      <Card className="p-3">
        <div className="text-[11px] text-muted-foreground mb-1">Carry-forward last {d.cf_trend.length} days</div>
        <div className="flex items-end gap-0.5 h-16">
          {d.cf_trend.map((x) => (
            <div key={x.d} className="flex-1 bg-priority-medium/70 rounded-t" style={{ height: `${(x.n / max) * 100}%` }} title={`${x.d}: ${x.n}`} />
          ))}
        </div>
      </Card>
    </Section>
  );
}

/* ---------------- 6. Automation ROI ---------------- */

function AutomationROI({ s }: { s: ExecSummary }) {
  const a = s.automation;
  const successRate = a.success_rate ?? 100;
  const max = Math.max(1, ...a.trend.map((x) => x.n));
  return (
    <Section title="Automation ROI" icon={<Bot className="h-4 w-4" />} action={
      <Link to="/configure/automations" className="text-xs text-primary hover:underline">Open engine</Link>
    }>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3 mb-2">
        <Kpi label="Today" value={a.today_runs} />
        <Kpi label="Range total" value={a.total_runs} sub={`${a.active_rules} active rules`} />
        <Kpi label="Success rate" value={a.total_runs === 0 ? "—" : `${successRate}%`} tone={a.total_runs === 0 ? "neutral" : toneForPct(successRate)} />
        <Kpi label="Failed (24h)" value={a.failed_24h} tone={a.failed_24h > 0 ? "warn" : "good"} />
        <Kpi label="Dead-letter (24h)" value={a.dead_24h} tone={a.dead_24h > 0 ? "bad" : "good"} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Card className="p-3">
          <div className="text-[11px] text-muted-foreground mb-1">Activity last {a.trend.length} days</div>
          <div className="flex items-end gap-0.5 h-16">
            {a.trend.map((x) => (
              <div key={x.d} className="flex-1 bg-primary/70 rounded-t" style={{ height: `${(x.n / max) * 100}%` }} title={`${x.d}: ${x.n}`} />
            ))}
          </div>
        </Card>
        <Card className="p-3 space-y-1 text-sm">
          <Row label="Follow-ups auto-created" value={a.follow_ups} />
          <Row label="Approvals auto-created" value={a.approvals_auto} />
          <Row label="Escalations generated" value={a.escalations} />
          <Row label="Pending queue" value={a.pending} tone={a.pending > 5000 ? "warn" : undefined} />
        </Card>
      </div>
    </Section>
  );
}

/* ---------------- 7. Adoption ---------------- */

function AdoptionMetrics({ s }: { s: ExecSummary }) {
  const a = s.adoption;
  const total = Math.max(1, a.total_members);
  const max = Math.max(1, ...a.dau_trend.map((x) => x.n));
  return (
    <Section title="Adoption Metrics" icon={<Sparkles className="h-4 w-4" />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 mb-2">
        <Kpi label="DAU" value={a.dau} sub={`of ${total} members`} />
        <Kpi label="WAU" value={a.wau} sub={`of ${total} members`} />
        <Kpi label="EOD users (range)" value={a.eod_users} sub={`${Math.round((a.eod_users / total) * 100)}%`} />
        <Kpi label="Status updaters" value={a.status_users} sub={`${Math.round((a.status_users / total) * 100)}%`} />
      </div>
      <Card className="p-3">
        <div className="text-[11px] text-muted-foreground mb-1">Daily active users · last {a.dau_trend.length} days</div>
        <div className="flex items-end gap-0.5 h-16">
          {a.dau_trend.map((x) => (
            <div key={x.d} className="flex-1 bg-status-completed/70 rounded-t" style={{ height: `${(x.n / max) * 100}%` }} title={`${x.d}: ${x.n}`} />
          ))}
        </div>
      </Card>
    </Section>
  );
}

/* ---------------- 8. Team Health ---------------- */

function TeamHealthSection({ s }: { s: ExecSummary }) {
  const rows = s.team_health;
  if (rows.length === 0) return null;
  return (
    <Section title="Team Health" icon={<CheckCircle2 className="h-4 w-4" />}>
      <Card className="p-3 divide-y">
        {rows.map((r) => {
          const tone = r.score >= 85 ? "text-status-completed" : r.score >= 70 ? "text-priority-medium" : "text-priority-high";
          return (
            <div key={r.team} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-sm">
              <div className="min-w-0 truncate font-medium">{r.team}</div>
              <div className="text-xs text-muted-foreground truncate hidden sm:block">{r.manager}</div>
              <div className={`text-right text-base font-semibold tabular-nums ${tone}`}>{r.score}</div>
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

/* ---------------- 9. Manager Effectiveness ---------------- */

function ManagerEffectivenessSection({ s }: { s: ExecSummary }) {
  const rows = s.manager_effectiveness;
  if (rows.length === 0) return null;
  return (
    <Section title="Manager Effectiveness" icon={<TrendingUp className="h-4 w-4" />}>
      <Card className="p-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b">
              <th className="text-left py-1.5">Manager</th>
              <th className="text-right">Completion</th>
              <th className="text-right">Overdue</th>
              <th className="text-right">Appr. hrs</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const flag = r.completion >= 85 ? "Top" : r.completion < 60 ? "Attn" : "";
              return (
                <tr key={r.manager} className="border-b last:border-0">
                  <td className="py-1.5 truncate max-w-[140px]">{r.manager}</td>
                  <td className="text-right tabular-nums">{r.completion}%</td>
                  <td className={`text-right tabular-nums ${r.overdue > 0 ? "text-priority-high" : ""}`}>{r.overdue}</td>
                  <td className="text-right tabular-nums">{r.appr || "—"}</td>
                  <td className="text-right">
                    {flag === "Top" && <Badge className="bg-status-completed/15 text-status-completed border border-status-completed/30">Top</Badge>}
                    {flag === "Attn" && <Badge className="bg-priority-high/15 text-priority-high border border-priority-high/30">Attention</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

/* ---------------- 10. Executive Insights ---------------- */

function ExecutiveInsights({ s }: { s: ExecSummary }) {
  const ins: { text: string; tone: "good" | "warn" | "bad" | "neutral" }[] = [];
  const i = s.insights_inputs;

  if (i.cf_prev_7d > 0) {
    const delta = Math.round(((i.cf_last_7d - i.cf_prev_7d) / i.cf_prev_7d) * 100);
    if (Math.abs(delta) >= 10) ins.push({
      text: `Carry-forward ${delta >= 0 ? "increased" : "decreased"} ${Math.abs(delta)}% this week.`,
      tone: delta >= 0 ? "bad" : "good",
    });
  }

  if (s.automation.follow_ups > 5) {
    ins.push({ text: `Automation auto-created ${s.automation.follow_ups} follow-up work items in the last ${s.meta.days} days.`, tone: "good" });
  }

  // Fixed: server-side comparison (P1 #4) — pending growth via aged subset
  if (i.approvals_pending_now > 0 && i.approvals_pending_over_7d > 0) {
    ins.push({
      text: `${i.approvals_pending_over_7d} of ${i.approvals_pending_now} pending approvals are older than 7 days.`,
      tone: i.approvals_pending_over_7d >= 5 ? "warn" : "neutral",
    });
  }

  // Visible-only team overload (P1 #5)
  for (const t of i.team_overload) {
    ins.push({ text: `${t.name} currently overloaded by ${t.pct - 100}%.`, tone: "bad" });
  }

  if (s.automation.auto_disabled_rules > 0) {
    ins.push({ text: `${s.automation.auto_disabled_rules} automation rule(s) auto-disabled by circuit breaker.`, tone: "bad" });
  }

  if (ins.length === 0) ins.push({ text: "No significant changes detected. Execution metrics are stable.", tone: "good" });

  return (
    <Section title="Executive Insights" icon={<AlertTriangle className="h-4 w-4" />}>
      <Card className="p-3 space-y-2">
        {ins.slice(0, 8).map((x, idx) => {
          const Icon = x.tone === "bad" ? AlertOctagon : x.tone === "warn" ? AlertTriangle : x.tone === "good" ? CheckCircle2 : Sparkles;
          const c = x.tone === "bad" ? "text-priority-high" : x.tone === "warn" ? "text-priority-medium" : x.tone === "good" ? "text-status-completed" : "text-muted-foreground";
          return (
            <div key={idx} className="flex items-start gap-2 text-sm">
              <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${c}`} />
              <span className="min-w-0">{x.text}</span>
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

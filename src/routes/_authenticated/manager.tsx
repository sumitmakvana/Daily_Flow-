import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getManagerCommand, type AtRiskRow, type CapacityRow, type ManagerAction, type ApprovalQueueRow, type ProjectHealthRow } from "@/lib/manager.functions";
import { Activity, AlertOctagon, ArrowRight, ClipboardCheck, Flame, Gauge, RefreshCw, ShieldAlert, Sparkles, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/manager")({
  component: ManagerPage,
});

function ManagerPage() {
  const router = useRouter();
  const fetchCmd = useServerFn(getManagerCommand);
  const q = useQuery({
    queryKey: ["manager-command"],
    queryFn: () => fetchCmd(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  if (q.isLoading) {
    return (
      <div className="p-3 md:p-6 max-w-6xl mx-auto space-y-3">
        <div className="h-20 bg-muted/50 animate-pulse rounded-xl" />
        <div className="h-72 bg-muted/50 animate-pulse rounded-xl" />
      </div>
    );
  }
  if (q.error || !q.data) {
    return <div className="p-6 text-sm text-destructive">Failed to load. <Button size="sm" variant="ghost" onClick={() => q.refetch()}>Retry</Button></div>;
  }

  const d = q.data;
  const scopeLabel = d.meta.scope === "admin" ? "Organization" : d.meta.scope === "team" ? "My team" : "Direct reports";

  return (
    <div className="p-3 md:p-6 max-w-6xl mx-auto space-y-3 md:space-y-4">
      {/* Header */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl md:text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 shrink-0 text-primary" /> Command Center
          </h1>
          <p className="text-xs text-muted-foreground">Scope: <span className="text-foreground font-medium">{scopeLabel}</span> · {d.meta.team_size} members · {d.kpis.total_open} open items</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => router.invalidate()} className="shrink-0">
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </header>

      {/* SECTION 1 — Team Health */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><Activity className="h-4 w-4 text-primary" /> Team health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Kpi label="Health" value={`${d.kpis.health_score}`} suffix="/100" tone={d.kpis.health_score >= 70 ? "good" : d.kpis.health_score >= 50 ? "warn" : "bad"} big />
            <Kpi label="Completion" value={`${d.kpis.completion_pct}%`} />
            <Kpi label="Blocked" value={`${d.kpis.blocked_pct}%`} tone={d.kpis.blocked_pct >= 10 ? "warn" : "good"} />
            <Kpi label="Carry-forward" value={`${d.kpis.carry_forward_pct}%`} tone={d.kpis.carry_forward_pct >= 15 ? "warn" : "good"} />
            <Kpi label="Approval avg" value={d.kpis.approval_turnaround_hours == null ? "—" : `${d.kpis.approval_turnaround_hours}h`} />
          </div>
        </CardContent>
      </Card>

      {/* SECTION 4 — Recommended actions (lifted up: this is what managers act on) */}
      {d.actions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-primary" /> Recommended actions ({d.actions.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {d.actions.map((a, i) => <ActionRow key={i} action={a} />)}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* SECTION 2 — Capacity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><Gauge className="h-4 w-4 text-primary" /> Team capacity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {d.capacity.length === 0 ? (
            <Empty text="No team members in scope." />
          ) : (
            <ul className="divide-y divide-border">{d.capacity.map((c) => <CapacityRowView key={c.user_id} row={c} />)}</ul>
          )}
        </CardContent>
      </Card>

      {/* SECTION 3 — At Risk */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><AlertOctagon className="h-4 w-4 text-priority-high" /> At-risk work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <RiskBucket label="Blocked" tone="destructive" items={d.at_risk.blocked} />
          <RiskBucket label="Delayed" tone="warn" items={d.at_risk.delayed} />
          <RiskBucket label="High severity" tone="destructive" items={d.at_risk.high_risk} />
          <RiskBucket label="Repeated carry-forward" tone="warn" items={d.at_risk.repeat_cf} />
          {d.at_risk.blocked.length + d.at_risk.delayed.length + d.at_risk.high_risk.length + d.at_risk.repeat_cf.length === 0 && (
            <Empty text="Nothing at risk right now." />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        {/* SECTION 5 — Project health */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-primary" /> Project health</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {d.projects.length === 0 ? <Empty text="No project activity." /> : (
              <ul className="divide-y divide-border">{d.projects.map((p) => <ProjectRow key={p.id} project={p} />)}</ul>
            )}
          </CardContent>
        </Card>

        {/* SECTION 6 — Approvals */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5"><ClipboardCheck className="h-4 w-4 text-primary" /> Approvals
              <span className="ml-auto text-[10px] text-muted-foreground font-normal">
                {d.approvals.counts.pending}· <span className="text-priority-medium">{d.approvals.counts.aging} aging</span> · <span className="text-priority-high">{d.approvals.counts.escalated} esc</span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {d.approvals.pending.length === 0 ? <Empty text="No approvals waiting." /> : (
              <ul className="divide-y divide-border">{d.approvals.pending.map((a) => <ApprovalRow key={a.request_id} approval={a} />)}</ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-[10px] text-muted-foreground text-center pt-2 pb-6">
        Generated {new Date(d.meta.generated_at).toLocaleTimeString()} · Rules: load&gt;120% red · &lt;60% blue · approval esc&gt;72h
      </p>
    </div>
  );
}

function Kpi({ label, value, suffix, tone, big }: { label: string; value: string; suffix?: string; tone?: "good" | "warn" | "bad"; big?: boolean }) {
  const cls = tone === "bad" ? "text-priority-high" : tone === "warn" ? "text-priority-medium" : tone === "good" ? "text-status-completed" : "";
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div className={cn(big ? "text-3xl" : "text-xl", "font-bold leading-tight", cls)}>{value}<span className="text-xs text-muted-foreground font-normal">{suffix}</span></div>
    </div>
  );
}

function CapacityRowView({ row }: { row: CapacityRow }) {
  const barCls = row.zone === "red" ? "bg-priority-high" : row.zone === "blue" ? "bg-primary" : "bg-status-completed";
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 min-h-12">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{row.name}</div>
        <div className="text-[11px] text-muted-foreground truncate">
          {row.open} open · {row.blocked > 0 && <span className="text-priority-high">{row.blocked} blocked · </span>}{row.overdue > 0 && <span className="text-priority-medium">{row.overdue} overdue · </span>}{row.planned_hours}h planned
        </div>
      </div>
      <div className="w-28 sm:w-44 shrink-0">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={cn("h-full transition-all", barCls)} style={{ width: `${Math.min(100, row.load_pct)}%` }} />
        </div>
        <div className="flex justify-between text-[10px] mt-0.5">
          <span className={cn(
            "font-semibold",
            row.zone === "red" ? "text-priority-high" : row.zone === "blue" ? "text-primary" : "text-status-completed"
          )}>{row.load_pct}%</span>
          <span className="text-muted-foreground">{row.remaining_hours}h free</span>
        </div>
      </div>
    </li>
  );
}

function RiskBucket({ label, items, tone }: { label: string; items: AtRiskRow[]; tone: "destructive" | "warn" }) {
  if (items.length === 0) return null;
  const toneCls = tone === "destructive" ? "text-priority-high" : "text-priority-medium";
  return (
    <div>
      <div className={cn("text-[11px] uppercase tracking-wide font-semibold mb-1.5 flex items-center gap-1", toneCls)}>
        <Flame className="h-3 w-3" /> {label} ({items.length})
      </div>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.id + i.reason} className="flex items-center gap-2 text-xs min-h-9 px-2 py-1 rounded-md bg-muted/30">
            <span className="font-mono text-[10px] text-muted-foreground shrink-0">{i.task_code}</span>
            <span className="truncate flex-1">{i.task_name}</span>
            {i.owner_name && <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">{i.owner_name}</span>}
            {i.reason === "blocked" && i.blocked_age_days != null && <Badge variant="destructive" className="text-[9px] h-4 px-1 shrink-0">{i.blocked_age_days}d</Badge>}
            {i.reason === "delayed" && i.due_date && <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">{i.due_date}</Badge>}
            {i.reason === "repeat_cf" && <Badge variant="destructive" className="text-[9px] h-4 px-1 shrink-0">CF×{i.carry_forward_count}</Badge>}
            {i.reason === "high_risk" && i.risk_severity && <Badge variant="destructive" className="text-[9px] h-4 px-1 shrink-0 capitalize">{i.risk_severity}</Badge>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionRow({ action }: { action: ManagerAction }) {
  const kindStyle: Record<ManagerAction["kind"], { label: string; cls: string }> = {
    REASSIGN:  { label: "Reassign",  cls: "bg-primary/15 text-primary border-primary/30" },
    ESCALATE:  { label: "Escalate",  cls: "bg-priority-high/15 text-priority-high border-priority-high/30" },
    FOLLOW_UP: { label: "Follow up", cls: "bg-priority-medium/15 text-priority-medium border-priority-medium/30" },
    APPROVE:   { label: "Approve",   cls: "bg-status-completed/15 text-status-completed border-status-completed/30" },
  };
  const s = kindStyle[action.kind];
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 min-h-14">
      <Badge variant="outline" className={cn("shrink-0 text-[10px]", s.cls)}>{s.label}</Badge>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{action.title}</div>
        <div className="text-[11px] text-muted-foreground line-clamp-2">{action.detail}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-40 shrink-0" />
    </li>
  );
}

function ProjectRow({ project }: { project: ProjectHealthRow }) {
  const tone = project.status === "late" ? "bg-priority-high/15 text-priority-high border-priority-high/30" : project.status === "risk" ? "bg-priority-medium/15 text-priority-medium border-priority-medium/30" : "bg-status-completed/15 text-status-completed border-status-completed/30";
  const label = project.status === "late" ? "Delayed" : project.status === "risk" ? "At risk" : "On track";
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 min-h-12">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{project.name}</div>
        <div className="text-[11px] text-muted-foreground">{project.open}/{project.total} open · {project.overdue} overdue · {project.blocked} blocked</div>
      </div>
      <Badge variant="outline" className={cn("shrink-0 text-[10px]", tone)}>{label}</Badge>
    </li>
  );
}

function ApprovalRow({ approval }: { approval: ApprovalQueueRow }) {
  const tone = approval.state === "escalated" ? "destructive" : approval.state === "aging" ? "secondary" : "outline";
  const ageLabel = approval.age_hours < 24 ? `${Math.round(approval.age_hours)}h` : `${Math.round(approval.age_hours / 24)}d`;
  return (
    <li className="flex items-center gap-2 px-3 py-2.5 min-h-12">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{approval.work_item_code} · {approval.work_item_name}</div>
        <div className="text-[11px] text-muted-foreground truncate">Step: {approval.step_name}</div>
      </div>
      <Badge variant={tone} className="shrink-0 text-[10px]">{ageLabel}</Badge>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-3 py-6 text-sm text-muted-foreground text-center">{text}</div>;
}

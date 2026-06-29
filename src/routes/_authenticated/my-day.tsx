import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getMyDay, type MyDayItem } from "@/lib/my-day.functions";
import { AlertOctagon, AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, Clock, Flame, GripVertical, Inbox, RotateCcw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/my-day")({
  component: MyDayPage,
});

function MyDayPage() {
  const router = useRouter();
  const fetchMyDay = useServerFn(getMyDay);
  const q = useQuery({
    queryKey: ["my-day"],
    queryFn: () => fetchMyDay(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  if (q.isLoading) {
    return (
      <div className="p-3 md:p-6 max-w-5xl mx-auto space-y-3">
        <div className="h-24 bg-muted/50 animate-pulse rounded-xl" />
        <div className="h-72 bg-muted/50 animate-pulse rounded-xl" />
      </div>
    );
  }
  if (q.error || !q.data) {
    return <div className="p-6 text-sm text-destructive">Failed to load My Day. <Button size="sm" variant="ghost" onClick={() => q.refetch()}>Retry</Button></div>;
  }

  const d = q.data;
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  })();

  const utilPct = Math.min(100, Math.round((d.workload.planned_hours / Math.max(1, d.workload.capacity_hours)) * 100));

  return (
    <div className="p-3 md:p-6 max-w-5xl mx-auto space-y-3 md:space-y-4">
      {/* Header */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl md:text-2xl font-bold">{greeting}</h1>
          <p className="text-xs text-muted-foreground">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} · {d.priorities.length} priorities
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => router.invalidate()} className="shrink-0">Refresh</Button>
      </header>

      {/* Workload + EOD preview */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="col-span-2 sm:col-span-1">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><Clock className="h-4 w-4 text-primary" /> Today's workload</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div className="text-2xl font-bold">{d.workload.planned_hours}h</div>
              <div className="text-xs text-muted-foreground">of {d.workload.capacity_hours}h</div>
            </div>
            <Progress value={utilPct} className="h-2" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Remaining: <span className="text-foreground font-medium">{d.workload.remaining_hours}h</span></span>
              <span>{d.workload.completed_today} done</span>
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-primary" /> End-of-day preview</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div className="text-2xl font-bold">{d.eod_preview.expected_completion_pct}%</div>
              <div className="text-xs text-muted-foreground">expected</div>
            </div>
            <Progress value={d.eod_preview.expected_completion_pct} className="h-2" />
            <p className="text-xs text-muted-foreground">{d.eod_preview.expected_done} of {d.eod_preview.open_today} items on track</p>
          </CardContent>
        </Card>
      </div>

      {/* Priorities — execution order */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><Flame className="h-4 w-4 text-priority-high" /> Today's priorities — suggested order</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {d.priorities.length === 0 ? (
            <EmptyRow icon={<CheckCircle2 className="h-5 w-5" />} text="Nothing on your plate. Enjoy the calm." />
          ) : (
            <ol className="divide-y divide-border">
              {d.priorities.map((item, idx) => <PriorityRow key={item.id} rank={idx + 1} item={item} />)}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Risks */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-priority-high" /> Risks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <RiskGroup label="Overdue" tone="destructive" items={d.risks.overdue} />
          <RiskGroup label="At risk" tone="warn" items={d.risks.at_risk} />
          <RiskGroup label="High severity" tone="destructive" items={d.risks.high_severity} />
          <RiskGroup label="Awaiting approval" tone="info" items={d.risks.approval_waiting} />
          {d.risks.overdue.length + d.risks.at_risk.length + d.risks.high_severity.length + d.risks.approval_waiting.length === 0 && (
            <EmptyRow icon={<CheckCircle2 className="h-5 w-5" />} text="No risks right now." />
          )}
        </CardContent>
      </Card>

      {/* Approvals */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><ClipboardCheck className="h-4 w-4 text-primary" /> Pending approvals ({d.approvals_pending.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {d.approvals_pending.length === 0 ? (
            <EmptyRow icon={<Inbox className="h-5 w-5" />} text="No approvals waiting on you." />
          ) : (
            <ul className="divide-y divide-border">
              {d.approvals_pending.map((a) => (
                <li key={a.request_id} className="flex items-center gap-2 px-3 py-2.5 min-h-12 active:bg-accent/50">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{a.work_item_code} · {a.work_item_name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">Step: {a.step_name}</div>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">Review</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Carry-forward */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5"><RotateCcw className="h-4 w-4 text-primary" /> Carry-forward</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <CarrySection label="Carried into today" items={d.carry_forward.today} />
          <CarrySection label="Repeated (3+ times)" items={d.carry_forward.repeated} accent />
          {d.carry_forward.today.length + d.carry_forward.repeated.length === 0 && (
            <EmptyRow icon={<CheckCircle2 className="h-5 w-5" />} text="Nothing carried over." />
          )}
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground text-center pt-2 pb-4">
        Generated {new Date(d.meta.generated_at).toLocaleTimeString()} · Score considers priority, due date, risk, carry-forward, approvals.
      </p>
    </div>
  );
}

function PriorityRow({ rank, item }: { rank: number; item: MyDayItem }) {
  return (
    <Link to="/tasks" className="flex items-stretch gap-2 px-3 py-2.5 min-h-14 active:bg-accent/50 hover:bg-accent/30 transition-colors">
      <div className="flex flex-col items-center justify-center w-7 shrink-0">
        <div className={cn(
          "h-7 w-7 grid place-items-center rounded-full text-xs font-bold",
          rank <= 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}>{rank}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono text-muted-foreground">{item.task_code}</span>
          {item.is_overdue && <Badge variant="destructive" className="text-[9px] h-4 px-1">Overdue</Badge>}
          {item.has_pending_approval && <Badge variant="outline" className="text-[9px] h-4 px-1">Approval</Badge>}
          {item.risk_severity && <Badge variant="outline" className="text-[9px] h-4 px-1 capitalize">{item.risk_severity}</Badge>}
          {item.is_blocked && <Badge variant="secondary" className="text-[9px] h-4 px-1">Blocked</Badge>}
          {item.carry_forward_count > 0 && <Badge variant="outline" className="text-[9px] h-4 px-1">CF×{item.carry_forward_count}</Badge>}
        </div>
        <div className="text-sm font-medium truncate">{item.task_name}</div>
        <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5">
          {item.project_name && <span className="truncate">{item.project_name}</span>}
          {item.due_date && <span className="flex items-center gap-0.5"><CalendarClock className="h-3 w-3" />{item.due_date}</span>}
          <span>· {item.planned_hours || 1}h</span>
          <span className={cn(
            "ml-auto font-semibold",
            item.priority === "High" ? "text-priority-high" : item.priority === "Low" ? "text-muted-foreground" : "text-foreground"
          )}>{item.priority}</span>
        </div>
      </div>
      <GripVertical className="h-4 w-4 text-muted-foreground self-center shrink-0 opacity-40" />
    </Link>
  );
}

function RiskGroup({ label, items, tone }: { label: string; items: MyDayItem[]; tone: "destructive" | "warn" | "info" }) {
  if (items.length === 0) return null;
  const toneCls = tone === "destructive" ? "text-priority-high" : tone === "warn" ? "text-priority-medium" : "text-primary";
  return (
    <div>
      <div className={cn("text-[11px] uppercase tracking-wide font-semibold mb-1.5 flex items-center gap-1", toneCls)}>
        <AlertOctagon className="h-3 w-3" /> {label} ({items.length})
      </div>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-xs min-h-9 px-2 py-1 rounded-md bg-muted/30">
            <span className="font-mono text-[10px] text-muted-foreground shrink-0">{i.task_code}</span>
            <span className="truncate flex-1">{i.task_name}</span>
            {i.due_date && <span className="text-[10px] text-muted-foreground shrink-0">{i.due_date}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CarrySection({ label, items, accent }: { label: string; items: MyDayItem[]; accent?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className={cn("text-[11px] uppercase tracking-wide font-semibold mb-1.5", accent ? "text-priority-high" : "text-muted-foreground")}>{label} ({items.length})</div>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-xs min-h-9 px-2 py-1 rounded-md bg-muted/30">
            <span className="font-mono text-[10px] text-muted-foreground shrink-0">{i.task_code}</span>
            <span className="truncate flex-1">{i.task_name}</span>
            <Badge variant={accent ? "destructive" : "outline"} className="text-[9px] h-4 px-1 shrink-0">CF×{i.carry_forward_count}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground justify-center">
      <span className="text-status-completed">{icon}</span> {text}
    </div>
  );
}

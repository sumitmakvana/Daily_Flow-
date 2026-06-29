import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { intelligenceService, blockerRootCauses, type IntelligenceBundle } from "@/services/intelligence";
import { adoptionService, dauSeries } from "@/services/adoption";
import { SEVERITY_TONE, KIND_LABEL, SEVERITY_RANK } from "@/services/risks";
import type { AdoptionDaily, Profile } from "@/lib/types";
import { Brain, Activity, AlertOctagon, ArrowRightCircle, Users, Clock } from "lucide-react";

const ResponsiveContainer = lazy(() => import("recharts").then((m) => ({ default: m.ResponsiveContainer })));
const LineChart = lazy(() => import("recharts").then((m) => ({ default: m.LineChart })));
const Line = lazy(() => import("recharts").then((m) => ({ default: m.Line })));
const XAxis = lazy(() => import("recharts").then((m) => ({ default: m.XAxis })));
const YAxis = lazy(() => import("recharts").then((m) => ({ default: m.YAxis })));
const Tooltip = lazy(() => import("recharts").then((m) => ({ default: m.Tooltip })));

export const Route = createFileRoute("/_authenticated/intelligence")({
  component: IntelligencePage,
});

function IntelligencePage() {
  const { isManager } = useAuth();
  const [data, setData] = useState<IntelligenceBundle | null>(null);
  const [adoption, setAdoption] = useState<AdoptionDaily[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    intelligenceService.load(14).then(setData);
    adoptionService.last14().then(setAdoption);
    supabase.from("profiles").select("id,display_name,avatar_url").then(({ data: p }) => setProfiles((p ?? []) as Profile[]));
  }, []);

  const dau = useMemo(() => dauSeries(adoption), [adoption]);

  if (!isManager) {
    return <div className="max-w-md mx-auto px-3 py-12 text-center text-sm text-muted-foreground">Execution Intelligence is available to managers.</div>;
  }
  if (!data) return <div className="p-8 text-sm text-muted-foreground">Loading intelligence…</div>;

  const topRisks = [...data.risks].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).slice(0, 5);
  const carryOffenders = [...data.tasks].filter((t) => (t.carry_forward_count ?? 0) >= 2 && t.status !== "Completed").sort((a, b) => (b.carry_forward_count ?? 0) - (a.carry_forward_count ?? 0)).slice(0, 6);
  const slaAtRisk = data.tasks.filter((t) => t.sla_due_at && new Date(t.sla_due_at) < new Date(Date.now() + 48 * 3600 * 1000) && t.status !== "Completed");
  const reviewerQueue = new Map<string, number>();
  for (const t of data.tasks) if (t.status === "In Review" && t.reviewer) reviewerQueue.set(t.reviewer, (reviewerQueue.get(t.reviewer) ?? 0) + 1);
  const reviewers = Array.from(reviewerQueue.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const rootCauses = blockerRootCauses(data.tasks);
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? id.slice(0, 6);

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-4 py-4 space-y-3">
      <h1 className="text-xl font-semibold flex items-center gap-2">
        <Brain className="h-5 w-5 text-primary" /> Execution Intelligence
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card className="p-3">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><AlertOctagon className="h-4 w-4 text-priority-high" /> Risk hotspots</h2>
          {topRisks.length === 0 ? <p className="text-xs text-muted-foreground italic">No active risks.</p> : (
            <ul className="space-y-1.5">
              {topRisks.map((r) => (
                <li key={r.id} className="text-xs flex items-start gap-2">
                  <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] shrink-0 ${SEVERITY_TONE[r.severity]}`}>{KIND_LABEL[r.kind] ?? r.kind}</span>
                  <span className="truncate">{r.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-3">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><ArrowRightCircle className="h-4 w-4 text-priority-medium" /> Repeated carry-forwards</h2>
          {carryOffenders.length === 0 ? <p className="text-xs text-muted-foreground italic">None.</p> : (
            <ul className="space-y-1">
              {carryOffenders.map((t) => (
                <li key={t.id} className="text-xs flex items-center justify-between gap-2">
                  <span className="truncate"><span className="font-mono text-muted-foreground">{t.task_code}</span> · {t.task_name}</span>
                  <Badge variant="outline" className="text-[10px]">×{t.carry_forward_count}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-3">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Clock className="h-4 w-4" /> Reviewer bottlenecks</h2>
          {reviewers.length === 0 ? <p className="text-xs text-muted-foreground italic">Queue clear.</p> : (
            <ul className="space-y-1">
              {reviewers.map(([uid, n]) => (
                <li key={uid} className="text-xs flex items-center justify-between">
                  <span className="truncate">{profileName(uid)}</span>
                  <Badge variant={n > 5 ? "destructive" : "outline"} className="text-[10px]">{n} in review</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-3">
          <h2 className="text-sm font-semibold mb-2">Delay root causes</h2>
          {rootCauses.length === 0 ? <p className="text-xs text-muted-foreground italic">No blocker data.</p> : (
            <ul className="flex flex-wrap gap-1.5">
              {rootCauses.map((c) => (
                <li key={c.label}>
                  <Badge variant="outline" className="text-[10px] capitalize">{c.label} · {c.count}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-3">
          <h2 className="text-sm font-semibold mb-2">SLA at risk (48h)</h2>
          <div className="text-3xl font-semibold">{slaAtRisk.length}</div>
          <div className="text-xs text-muted-foreground mt-1">tasks approaching or past SLA</div>
        </Card>

        <Card className="p-3 md:col-span-2 lg:col-span-1">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Users className="h-4 w-4" /> Daily active users (14d)</h2>
          <div className="h-32">
            <Suspense fallback={<div className="text-xs text-muted-foreground">Loading chart…</div>}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dau}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="dau" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Suspense>
          </div>
        </Card>

        <Card className="p-3 md:col-span-2 lg:col-span-3">
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Activity className="h-4 w-4" /> Adoption summary (14d)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <Stat label="EOD submissions" value={String(adoption.filter((a) => a.eod_submitted).length)} />
            <Stat label="Status updates" value={String(adoption.reduce((s, a) => s + a.status_updates_count, 0))} />
            <Stat label="Blocker usage days" value={String(adoption.filter((a) => a.blocker_usage).length)} />
            <Stat label="Avg DAU" value={dau.length ? String(Math.round(dau.reduce((s, d) => s + d.dau, 0) / dau.length)) : "0"} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  );
}

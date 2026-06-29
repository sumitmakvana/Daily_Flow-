import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, AlertOctagon, Clock, ArrowRightCircle } from "lucide-react";
import type { Profile, EodCheckin, Task } from "@/lib/types";
import { todayISO } from "@/lib/format";
import { eodService } from "@/services/eod";
import { workloadService, utilTone } from "@/services/workload";
import { carryForwardService } from "@/services/carry-forward";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/eod")({
  component: EodBoardPage,
});

function EodBoardPage() {
  const { user, isManager } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [checkins, setCheckins] = useState<EodCheckin[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: p }, c, { data: t }] = await Promise.all([
      supabase.from("profiles").select("id,display_name,avatar_url"),
      eodService.listForDate(todayISO()),
      supabase.from("tasks").select("*"),
    ]);
    setProfiles((p ?? []) as Profile[]);
    setCheckins(c);
    setTasks((t ?? []) as Task[]);
  };
  useEffect(() => { load(); }, []);

  if (!user) return null;

  const utils = workloadService.computeToday(tasks);
  const submittedMap = new Map(checkins.map((c) => [c.user_id, c]));

  const runCarryForward = async () => {
    setBusy(true);
    let total = 0;
    let failed = 0;
    for (const p of profiles) {
      const res = await carryForwardService.carryAllOverdue(user.id, p.id);
      total += res.ok;
      failed += res.failed;
    }
    setBusy(false);
    toast.success(
      `Carried ${total} task${total === 1 ? "" : "s"} forward${failed ? ` · ${failed} failed` : ""}`,
    );
    load();
  };

  const snapshot = async () => {
    setBusy(true);
    try {
      const n = await workloadService.snapshotToday(tasks);
      toast.success(`Snapshot saved for ${n} member${n === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">End-of-day board</h1>
          <p className="text-xs text-muted-foreground">{todayISO()} · {checkins.length}/{profiles.length} submitted</p>
        </div>
        {isManager && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={snapshot} disabled={busy}>Save snapshot</Button>
            <Button size="sm" onClick={runCarryForward} disabled={busy}>
              <ArrowRightCircle className="h-4 w-4 mr-1" /> Carry forward all
            </Button>
          </div>
        )}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border bg-muted/30">
              <tr>
                <th className="text-left py-2 px-3 font-medium">Member</th>
                <th className="text-left font-medium">Status</th>
                <th className="text-left font-medium">Pending</th>
                <th className="text-left font-medium">Blocked</th>
                <th className="text-left font-medium hidden md:table-cell">Done</th>
                <th className="text-left font-medium hidden md:table-cell">Remaining</th>
                <th className="text-left font-medium">Load</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const c = submittedMap.get(p.id);
                const u = utils.get(p.id);
                const tone = u ? utilTone(u.planned_hours) : null;
                return (
                  <tr key={p.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 px-3">{p.display_name}</td>
                    <td>
                      {c ? (
                        <span className="inline-flex items-center gap-1 text-status-completed text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Submitted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                          <Circle className="h-3.5 w-3.5" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="text-xs">{c?.pending_count ?? u?.active ?? 0}</td>
                    <td className="text-xs">
                      {(c?.blocker_count ?? u?.blocked ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 text-status-blocked">
                          <AlertOctagon className="h-3 w-3" /> {c?.blocker_count ?? u?.blocked}
                        </span>
                      ) : 0}
                    </td>
                    <td className="hidden md:table-cell text-xs">{c?.completed_count ?? u?.completed ?? 0}</td>
                    <td className="hidden md:table-cell text-xs">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3 w-3" /> {c?.remaining_hours ?? u?.planned_hours ?? 0}h
                      </span>
                    </td>
                    <td>
                      {tone && (
                        <span className={`inline-block rounded-md border px-1.5 py-0.5 text-[10px] ${tone.className}`}>
                          {tone.label}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {profiles.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-xs text-muted-foreground">No members yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {checkins.some((c) => c.note) && (
        <Card className="p-3 space-y-2">
          <h2 className="text-sm font-semibold">Notes & flags</h2>
          {checkins.filter((c) => c.note).map((c) => (
            <div key={c.id} className="rounded-md border border-border p-2 text-xs">
              <div className="text-muted-foreground">{profiles.find((p) => p.id === c.user_id)?.display_name}</div>
              <div className="mt-0.5">{c.note}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

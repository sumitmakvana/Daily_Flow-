import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Profile, Task, WorkloadSnapshot } from "@/lib/types";
import { workloadService, utilTone } from "@/services/workload";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/heatmap")({
  component: HeatmapPage,
});

function HeatmapPage() {
  const { user, isManager } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [snaps, setSnaps] = useState<WorkloadSnapshot[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const load = async () => {
    const [{ data: p }, { data: t }, s] = await Promise.all([
      supabase.from("profiles").select("id,display_name,avatar_url"),
      supabase.from("tasks").select("*"),
      workloadService.last7Days(),
    ]);
    setProfiles((p ?? []) as Profile[]);
    setTasks((t ?? []) as Task[]);
    setSnaps(s);
  };
  useEffect(() => { load(); }, []);

  const days = useMemo(() => {
    const arr: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      arr.push(d.toISOString().slice(0, 10));
    }
    return arr;
  }, []);

  const todayMap = workloadService.computeToday(tasks);
  const snapKey = (uid: string, day: string) => `${uid}|${day}`;
  const snapMap = useMemo(() => {
    const m = new Map<string, WorkloadSnapshot>();
    for (const s of snaps) m.set(snapKey(s.user_id, s.snapshot_date), s);
    return m;
  }, [snaps]);

  const captureSnapshot = async () => {
    try {
      const n = await workloadService.snapshotToday(tasks);
      toast.success(`Snapshot saved for ${n} member${n === 1 ? "" : "s"}`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!user) return null;
  const today = days[days.length - 1];

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold">Workload heatmap</h1>
          <p className="text-xs text-muted-foreground">Last 7 days · planned hours per member</p>
        </div>
        {isManager && (
          <Button size="sm" variant="outline" onClick={captureSnapshot}>Capture today's snapshot</Button>
        )}
      </div>

      <Card className="p-3 overflow-x-auto">
        <table className="text-sm min-w-[640px] w-full">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="text-left font-medium py-1.5 pr-3">Member</th>
              {days.map((d) => (
                <th key={d} className="font-medium text-center px-1">
                  {new Date(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-t border-border/40">
                <td className="py-1.5 pr-3 text-xs font-medium">{p.display_name}</td>
                {days.map((d) => {
                  let planned = 0;
                  if (d === today) {
                    planned = todayMap.get(p.id)?.planned_hours ?? 0;
                  } else {
                    planned = Number(snapMap.get(snapKey(p.id, d))?.planned_hours ?? 0);
                  }
                  const tone = utilTone(planned);
                  return (
                    <td key={d} className="text-center px-1 py-1">
                      <div
                        title={`${planned}h planned`}
                        className={`h-10 rounded-md border text-[11px] flex items-center justify-center font-medium ${tone.className}`}
                      >
                        {planned ? `${planned}h` : "—"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr><td colSpan={days.length + 1} className="py-6 text-center text-xs text-muted-foreground">No members yet.</td></tr>
            )}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-muted-foreground">
          <Legend label="Under" className="bg-status-progress/15 border-status-progress/30" />
          <Legend label="Balanced" className="bg-status-completed/15 border-status-completed/30" />
          <Legend label="Near limit" className="bg-priority-medium/15 border-priority-medium/30" />
          <Legend label="Overloaded" className="bg-priority-high/15 border-priority-high/30" />
        </div>
      </Card>
    </div>
  );
}

function Legend({ label, className }: { label: string; className: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded-sm border ${className}`} />
      {label}
    </span>
  );
}

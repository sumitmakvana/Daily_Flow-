import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { CapacityBar } from "@/components/CapacityBar";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
import type { Profile, Task } from "@/lib/types";
import { isOverdue } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/workload")({
  component: WorkloadPage,
});

function WorkloadPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const load = useCallback(async () => {
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from("tasks").select("*"),
      supabase.from("profiles").select("id,display_name,avatar_url"),
    ]);
    setTasks((t ?? []) as Task[]);
    setProfiles((p ?? []) as Profile[]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtimeTasks(load, "workload-rt");

  const rows = useMemo(() => profiles.map((p) => {
    const own = tasks.filter((t) => t.assigned_to === p.id && t.status !== "Completed");
    const planned = own.reduce((s, t) => s + Number(t.planned_hours ?? 0), 0);
    const actual = tasks.filter((t) => t.assigned_to === p.id).reduce((s, t) => s + Number(t.actual_hours ?? 0), 0);
    const delayed = own.filter((t) => isOverdue(t.due_date, t.status)).length;
    const blocked = own.filter((t) => t.status === "Blocked").length;
    const state = planned > 40 ? "over" : planned < 10 ? "under" : "ok";
    return { profile: p, active: own.length, planned, actual, delayed, blocked, state };
  }).sort((a, b) => b.planned - a.planned), [tasks, profiles]);

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Workload</h1>
        <p className="text-xs text-muted-foreground">Planned vs actual hours per member (40h weekly capacity).</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((r) => (
          <Card key={r.profile.id} className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{r.profile.display_name}</div>
                <div className="text-xs text-muted-foreground">{r.active} active · {r.delayed} delayed · {r.blocked} blocked</div>
              </div>
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                r.state === "over" ? "border-priority-high/40 text-priority-high bg-priority-high/10" :
                r.state === "under" ? "border-priority-low/40 text-priority-low bg-priority-low/10" :
                "border-status-completed/40 text-status-completed bg-status-completed/10"
              }`}>{r.state === "over" ? "Overloaded" : r.state === "under" ? "Underutilized" : "Balanced"}</span>
            </div>
            <div className="mt-3"><CapacityBar planned={r.planned} actual={r.actual} /></div>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground italic">No team members yet.</p>}
      </div>
    </div>
  );
}

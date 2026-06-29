import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { PriorityBadge } from "@/components/PriorityBadge";
import { CarryForwardBadge } from "@/components/CarryForwardBadge";
import type { Profile, Task, TaskPriority } from "@/lib/types";
import { TASK_PRIORITIES } from "@/lib/types";
import { formatDate, isOverdue, nextWorkingDay } from "@/lib/format";
import { tasksService } from "@/services/tasks";
import { carryForwardService } from "@/services/carry-forward";
import { workloadService, utilTone } from "@/services/workload";
import { toast } from "sonner";
import { Calendar, User as UserIcon, Flag, ArrowRightCircle, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/planning")({
  component: PlanningPage,
});

function PlanningPage() {
  const { user, isManager } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [groupBy, setGroupBy] = useState<"member" | "priority">("member");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from("tasks").select("*").not("status", "in", '("Completed")').order("priority"),
      supabase.from("profiles").select("id,display_name,avatar_url"),
    ]);
    setTasks((t ?? []) as Task[]);
    setProfiles((p ?? []) as Profile[]);
    setSelected(new Set());
  };
  useEffect(() => { load(); }, []);

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; key: string; tasks: Task[] }>();
    if (groupBy === "member") {
      for (const p of profiles) m.set(p.id, { label: p.display_name, key: p.id, tasks: [] });
      m.set("__unassigned", { label: "Unassigned", key: "__unassigned", tasks: [] });
      for (const t of tasks) {
        const k = t.assigned_to ?? "__unassigned";
        m.get(k)?.tasks.push(t);
      }
    } else {
      for (const pr of TASK_PRIORITIES) m.set(pr, { label: pr, key: pr, tasks: [] });
      for (const t of tasks) m.get(t.priority)?.tasks.push(t);
    }
    return Array.from(m.values()).filter((g) => g.tasks.length > 0 || groupBy === "member");
  }, [tasks, profiles, groupBy]);

  const toggle = (id: string) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  const selectedTasks = tasks.filter((t) => selected.has(t.id));
  const utils = workloadService.computeToday(tasks);

  const bulkReassign = async (assigneeId: string) => {
    if (!user) return;
    for (const t of selectedTasks) {
      try { await tasksService.transfer(t, assigneeId, user.id); } catch (e) { toast.error((e as Error).message); }
    }
    toast.success(`Reassigned ${selectedTasks.length} task${selectedTasks.length === 1 ? "" : "s"}`);
    load();
  };
  const bulkPriority = async (p: TaskPriority) => {
    if (!user) return;
    for (const t of selectedTasks) {
      try { await tasksService.setPriority(t, p, user.id); } catch (e) { toast.error((e as Error).message); }
    }
    toast.success("Updated priority");
    load();
  };
  const bulkCarry = async () => {
    if (!user) return;
    for (const t of selectedTasks) {
      try { await carryForwardService.carry(t, user.id, nextWorkingDay(), "manager"); } catch (e) { toast.error((e as Error).message); }
    }
    toast.success(`Moved to tomorrow`);
    load();
  };

  if (!user) return null;
  if (!isManager) {
    return (
      <div className="max-w-md mx-auto px-3 py-8 text-center text-sm text-muted-foreground">
        Planning board is for managers and admins. <Link to="/today" className="text-primary underline">Go to Today</Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-4 py-4 space-y-4 pb-24">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Planning board</h1>
        <div className="flex items-center gap-2">
          <Select value={groupBy} onValueChange={(v) => setGroupBy(v as "member" | "priority")}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Group by member</SelectItem>
              <SelectItem value="priority">Group by priority</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-3">
        <div className="space-y-3">
          {groups.map((g) => (
            <Card key={g.key} className="p-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold">{g.label} <span className="text-muted-foreground font-normal">· {g.tasks.length}</span></h2>
              </div>
              {g.tasks.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No active tasks.</p>
              ) : (
                <ul className="space-y-1">
                  {g.tasks.map((t) => (
                    <li
                      key={t.id}
                      onClick={() => toggle(t.id)}
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                        selected.has(t.id) ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 accent-primary shrink-0"
                      />
                      <span className="font-mono text-muted-foreground">{t.task_code}</span>
                      <span className="font-medium truncate flex-1">{t.task_name}</span>
                      <PriorityBadge priority={t.priority} />
                      <StatusBadge status={t.status} />
                      <CarryForwardBadge count={t.carry_forward_count ?? 0} />
                      <span className={`hidden md:inline text-muted-foreground ${isOverdue(t.due_date, t.status) ? "text-priority-high" : ""}`}>
                        {formatDate(t.due_date)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>

        <aside className="hidden lg:block">
          <Card className="p-3 sticky top-16 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Capacity</h3>
            {profiles.map((p) => {
              const u = utils.get(p.id);
              const tone = utilTone(u?.planned_hours ?? 0);
              return (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">{p.display_name}</span>
                  <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] ${tone.className}`}>
                    {u?.planned_hours ?? 0}h
                  </span>
                </div>
              );
            })}
          </Card>
        </aside>
      </div>

      {selected.size > 0 && (
        <div className="fixed bottom-16 md:bottom-3 left-3 right-3 z-40">
          <Card className="p-2 flex flex-wrap items-center gap-2 shadow-lg border-primary/40">
            <span className="text-xs font-medium pl-1">{selected.size} selected</span>
            <Select onValueChange={bulkReassign}>
              <SelectTrigger className="h-8 w-36 text-xs"><UserIcon className="h-3 w-3 mr-1" /><SelectValue placeholder="Reassign" /></SelectTrigger>
              <SelectContent>
                {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select onValueChange={(v) => bulkPriority(v as TaskPriority)}>
              <SelectTrigger className="h-8 w-32 text-xs"><Flag className="h-3 w-3 mr-1" /><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={bulkCarry}>
              <Calendar className="h-3 w-3 mr-1" /> Move to tomorrow
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs ml-auto" onClick={() => setSelected(new Set())}>
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}

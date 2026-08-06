import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { TaskCard } from "@/components/TaskCard";
import { TaskFormDialog } from "@/components/TaskFormDialog";
import { EodReminder } from "@/components/EodReminder";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { Profile, Task } from "@/lib/types";
import { isToday, isOverdue } from "@/lib/format";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";

export const Route = createFileRoute("/_authenticated/today")({
  component: TodayPage,
});

function TodayPage() {
  const { user, isManager } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from("tasks").select("*").eq("assigned_to", user.id).order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("profiles").select("id,display_name,avatar_url"),
    ]);
    setTasks((t ?? []) as Task[]);
    setProfiles((p ?? []) as Profile[]);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);
  useRealtimeTasks(
    load,
    `today-${user?.id ?? "x"}`,
    user?.id ? { kind: "assignee", userId: user.id } : { kind: "all" },
  );

  const isTaskCompletedToday = useCallback((t: Task) => {
    if (t.status !== "Completed") return false;
    const todayIso = new Date().toISOString().slice(0, 10);
    const localTodayIso = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
    const todayDateStr = new Date().toDateString();

    if (t.completed_at) {
      const compDate = t.completed_at.slice(0, 10);
      if (compDate === todayIso || compDate === localTodayIso || isToday(t.completed_at)) {
        return true;
      }
    }
    if (t.updated_at) {
      const upDate = t.updated_at.slice(0, 10);
      if (upDate === todayIso || upDate === localTodayIso || isToday(t.updated_at)) {
        return true;
      }
    }
    if (t.due_date && isToday(t.due_date)) {
      return true;
    }
    return !t.completed_at;
  }, []);

  const today = useMemo(() => tasks.filter((t) => (isToday(t.due_date) || isOverdue(t.due_date, t.status)) && t.status !== "Completed" && t.status !== "Blocked"), [tasks]);
  const pending = useMemo(() => tasks.filter((t) => !isToday(t.due_date) && !isOverdue(t.due_date, t.status) && t.status !== "Completed" && t.status !== "Blocked"), [tasks]);
  const blocked = useMemo(() => tasks.filter((t) => t.status === "Blocked"), [tasks]);
  const completedToday = useMemo(() => tasks.filter(isTaskCompletedToday), [tasks, isTaskCompletedToday]);

  if (!user) return null;

  const Section = ({ title, items, tone }: { title: string; items: Task[]; tone?: string }) => (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className={tone}>{title}</span>
        <span className="text-muted-foreground/60">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1">Nothing here.</p>
      ) : (
        items.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            assignee={profiles.find((p) => p.id === t.assigned_to)}
            profiles={profiles}
            userId={user.id}
            canManage={isManager}
            onChanged={load}
          />
        ))
      )}
    </section>
  );

  return (
    <div className="max-w-4xl mx-auto px-3 md:px-6 py-6 space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My work today</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <Button size="sm" className="h-9 gap-1.5" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" /> New Task
        </Button>
      </div>
      <EodReminder tasks={tasks} userId={user.id} onDone={load} />
      <Section title="Today & overdue" items={today} tone="text-destructive font-semibold" />
      <Section title="Blocked" items={blocked} tone="text-amber-500 font-semibold" />
      <Section title="Pending" items={pending} />
      <Section title="Completed today" items={completedToday} tone="text-emerald-500 font-semibold" />
      <TaskFormDialog open={dialogOpen} onOpenChange={setDialogOpen} userId={user.id} onSaved={load} />
    </div>
  );
}

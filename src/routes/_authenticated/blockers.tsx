import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { TaskCard } from "@/components/TaskCard";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
import type { Profile, Task } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/blockers")({
  component: BlockersPage,
});

function BlockersPage() {
  const { user, isManager } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  const load = useCallback(async () => {
    const [{ data: t }, { data: p }] = await Promise.all([
      supabase.from("tasks").select("*").eq("status", "Blocked").order("blocked_at", { ascending: true }),
      supabase.from("profiles").select("id,display_name,avatar_url"),
    ]);
    setTasks((t ?? []) as Task[]);
    setProfiles((p ?? []) as Profile[]);
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtimeTasks(load, "blockers-rt");

  if (!user) return null;
  const critical = tasks.filter((t) => t.blocked_at && (Date.now() - new Date(t.blocked_at).getTime()) >= 3 * 86400000).length;

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Blockers</h1>
        <p className="text-xs text-muted-foreground">
          {tasks.length} blocked task{tasks.length === 1 ? "" : "s"}
          {critical > 0 && <> · <span className="text-priority-high">{critical} critical (3d+)</span></>}
        </p>
      </div>
      <div className="space-y-2">
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            assignee={profiles.find((p) => p.id === t.assigned_to)}
            profiles={profiles}
            userId={user.id}
            canManage={isManager}
            onChanged={load}
          />
        ))}
        {tasks.length === 0 && <p className="text-sm text-muted-foreground italic">No active blockers.</p>}
      </div>
    </div>
  );
}

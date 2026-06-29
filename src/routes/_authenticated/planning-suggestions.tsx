import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { SuggestionsPanel } from "@/components/SuggestionsPanel";
import { TomorrowRiskPanel } from "@/components/TomorrowRiskPanel";
import type { Profile, Task } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/planning-suggestions")({
  component: PlanningSuggestionsPage,
});

function PlanningSuggestionsPage() {
  const { isManager } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    Promise.all([
      supabase.from("tasks").select("*"),
      supabase.from("profiles").select("id,display_name,avatar_url"),
    ]).then(([t, p]) => {
      setTasks(((t.data ?? []) as Task[]));
      setProfiles(((p.data ?? []) as Profile[]));
    });
  }, []);

  if (!isManager) {
    return <div className="max-w-md mx-auto px-3 py-12 text-center text-sm text-muted-foreground">Smart planning is available to managers.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <h1 className="text-xl font-semibold">Smart planning</h1>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
        <SuggestionsPanel profiles={profiles} tasks={tasks} />
        <TomorrowRiskPanel tasks={tasks} />
      </div>
    </div>
  );
}

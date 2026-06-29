import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, X, Lightbulb, RefreshCw } from "lucide-react";
import { planningSuggestionsService, SUGGESTION_KIND_LABEL } from "@/services/planning-suggestions";
import { SEVERITY_TONE } from "@/services/risks";
import { tasksService } from "@/services/tasks";
import { carryForwardService } from "@/services/carry-forward";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { PlanningSuggestion, Profile, Task, TaskPriority } from "@/lib/types";
import { nextWorkingDay } from "@/lib/format";
import { toast } from "sonner";

export function SuggestionsPanel({
  profiles,
  tasks,
  compact = false,
}: {
  profiles: Profile[];
  tasks: Task[];
  compact?: boolean;
}) {
  const { user, isManager } = useAuth();
  const [items, setItems] = useState<PlanningSuggestion[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => planningSuggestionsService.listOpen().then(setItems).catch(() => undefined);
  useEffect(() => {
    load();
    const ch = supabase
      .channel("planning-suggestions-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "planning_suggestions" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  if (!isManager || !user) return null;

  const generate = async () => {
    setBusy(true);
    try {
      const ok = await planningSuggestionsService.generateNow();
      toast[ok ? "success" : "error"](ok ? "Suggestions refreshed" : "Refresh failed");
      load();
    } finally { setBusy(false); }
  };

  const profileById = (id?: string | null) => profiles.find((p) => p.id === id);

  const accept = async (s: PlanningSuggestion) => {
    if (!user) return;
    const task = s.task_id ? tasks.find((t) => t.id === s.task_id) : undefined;
    try {
      if (s.kind === "reassign" && task && s.to_user_id) {
        await tasksService.transfer(task, s.to_user_id, user.id);
      } else if (s.kind === "priority" && task) {
        const order: TaskPriority[] = ["Low","Medium","High"];
        const next = order[Math.min(order.indexOf(task.priority) + 1, order.length - 1)] ?? task.priority;
        await tasksService.setPriority(task, next, user.id);
      } else if (s.kind === "due_date" && task) {
        await carryForwardService.carry(task, user.id, nextWorkingDay(), "manager");
      }
      await planningSuggestionsService.resolve(s.id, "accepted", user.id);
      toast.success("Applied");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const dismiss = async (s: PlanningSuggestion) => {
    if (!user) return;
    await planningSuggestionsService.resolve(s.id, "dismissed", user.id);
    setItems((xs) => xs.filter((x) => x.id !== s.id));
  };

  const visible = compact ? items.slice(0, 4) : items;

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          <Lightbulb className="h-4 w-4 text-primary" /> Smart planning suggestions
        </h2>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={generate} disabled={busy}>
          <RefreshCw className={"h-3 w-3 mr-1 " + (busy ? "animate-spin" : "")} /> Refresh
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-4 text-center">
          No suggestions right now. The engine refreshes nightly at 18:00.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => (
            <li key={s.id} className="rounded-md border border-border p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_TONE[s.severity]}`}>
                  {SUGGESTION_KIND_LABEL[s.kind] ?? s.kind}
                </span>
                <span className="text-[10px] text-muted-foreground capitalize">{s.severity}</span>
                {s.to_user_id && (
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    → {profileById(s.to_user_id)?.display_name ?? "user"}
                  </span>
                )}
              </div>
              <p className="text-xs leading-snug">{s.reason}</p>
              <div className="mt-1.5 flex items-center gap-1">
                <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => accept(s)}>
                  <Check className="h-3 w-3 mr-1" /> Accept
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => dismiss(s)}>
                  <X className="h-3 w-3 mr-1" /> Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {compact && items.length > 4 && (
        <p className="mt-2 text-[10px] text-muted-foreground text-right">+{items.length - 4} more</p>
      )}
    </Card>
  );
}

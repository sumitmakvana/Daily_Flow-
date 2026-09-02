import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyDay } from "@/lib/my-day.functions";
import { activeTimerStore } from "@/services/active-timer-store";
import { tasksService } from "@/services/tasks";
import { Button } from "@/components/ui/button";
import {
  Pause,
  CheckCircle2,
  Clock,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/types";
import { toast } from "sonner";
import { inlineCompleteStore } from "@/services/inline-complete-store";

export function ActiveTasksFloatingBar({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    return activeTimerStore.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ["my-day"] });
    });
  }, [queryClient]);

  const { data: myDayData } = useQuery({
    queryKey: ["my-day"],
    queryFn: getMyDay,
    enabled: !!userId,
    refetchInterval: 5000,
  });

  const allTasksMap = new Map<string, Task>();
  if (myDayData) {
    const sources = [
      myDayData.priorities ?? [],
      myDayData.risks?.overdue ?? [],
      myDayData.risks?.at_risk ?? [],
      myDayData.risks?.high_severity ?? [],
      myDayData.risks?.approval_waiting ?? [],
    ];
    for (const list of sources) {
      for (const item of list as unknown as Task[]) {
        if (item && item.id && !allTasksMap.has(item.id)) {
          allTasksMap.set(item.id, item);
        }
      }
    }
  }
  const allTasks: Task[] = Array.from(allTasksMap.values());

  // Single active task running ("In Progress")
  const primaryTask = allTasks.find((t) => t.status === "In Progress");

  // Ticking elapsed timer for primary active task
  const [primaryElapsed, setPrimaryElapsed] = useState("00:00:00");

  useEffect(() => {
    if (!primaryTask) return;

    const tick = () => {
      const startedAtStr = (primaryTask as any).started_at;
      if (!startedAtStr) {
        setPrimaryElapsed("00:00:00");
        return;
      }
      const startMs = new Date(startedAtStr).getTime();
      const nowMs = Date.now();
      const diffSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));

      const hrs = Math.floor(diffSec / 3600);
      const mins = Math.floor((diffSec % 3600) / 60);
      const secs = diffSec % 60;

      const pad = (n: number) => n.toString().padStart(2, "0");
      setPrimaryElapsed(`${pad(hrs)}:${pad(mins)}:${pad(secs)}`);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [primaryTask]);

  if (!primaryTask) {
    return null;
  }

  const handlePausePrimary = async () => {
    if (!primaryTask) return;
    try {
      await tasksService.setStatus(primaryTask, "On Hold", userId, {
        hold_reason: "Paused from active bar",
      });
      toast.success(`${primaryTask.task_code} paused`);
      queryClient.invalidateQueries({ queryKey: ["my-day"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleCompletePrimary = async () => {
    if (!primaryTask) return;
    inlineCompleteStore.open(primaryTask.id);
  };

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 transition-all duration-200 ease-in-out max-w-sm w-[calc(100vw-2rem)] md:w-auto",
        "bg-card/95 backdrop-blur-md border border-border/80 rounded-xl shadow-2xl overflow-hidden"
      )}
    >
      {/* Bar Header */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-popover/80 border-b border-border/40 text-xs">
        <div className="flex items-center gap-2 font-mono font-medium">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-foreground font-semibold">Active Running Task</span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setIsMinimized(!isMinimized)}
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
        >
          {isMinimized ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {!isMinimized && (
        <div className="p-3">
          <div className="flex items-center justify-between gap-3 p-2.5 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] font-bold text-blue-400">
                  {primaryTask.task_code}
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-blue-300 bg-blue-500/20 px-1.5 py-0.5 rounded border border-blue-500/30">
                  <Clock className="w-3 h-3" />
                  {primaryElapsed}
                </span>
              </div>
              <p className="text-xs font-medium text-foreground truncate mt-0.5">
                {primaryTask.task_name}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="icon"
                variant="ghost"
                onClick={handlePausePrimary}
                title="Pause Active Timer"
                className="h-7 w-7 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
              >
                <Pause className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleCompletePrimary}
                title="Complete Task"
                className="h-7 w-7 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
              >
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


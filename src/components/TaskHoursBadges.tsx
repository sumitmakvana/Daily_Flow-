import { useEffect, useState } from "react";
import { formatHoursMins } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface TaskHoursData {
  planned_hours?: number | null;
  actual_hours?: number | null;
  started_at?: string | null;
  system_hours?: number | null;
  status?: string | null;
}

interface TaskHoursBadgesProps {
  task: TaskHoursData;
  variant?: "capsule" | "badges";
  className?: string;
}

export function TaskHoursBadges({ task, className }: TaskHoursBadgesProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!task.started_at || task.status !== "In Progress") return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [task.started_at, task.status]);

  const plan = task.planned_hours ?? 0;
  const logged = task.actual_hours ?? 0;
  const baseSys = Number(task.system_hours ?? 0);
  const runningSys = (task.started_at && task.status === "In Progress")
    ? Math.min(8.0, Math.max(0, (Date.now() - new Date(task.started_at).getTime()) / 3600000))
    : 0;
  const sysHrs = baseSys + runningSys;

  const hasGap =
    (task.status === "Completed" && logged === 0 && sysHrs >= 1.0) ||
    (logged > 0 && sysHrs > 0 && Math.abs(sysHrs - logged) >= 1.5) ||
    (plan > 0 && sysHrs > plan + 1.5 && logged === 0);
  const isOverrun =
    (task.status === "In Progress" && (sysHrs >= 8.0 || (plan > 0 && sysHrs > plan))) ||
    (task.status === "Completed" && plan > 0 && (logged === 0 || logged > plan || logged >= 8.0));

  if (plan === 0 && logged === 0 && sysHrs === 0) {
    return (
      <span className={cn("font-mono text-[10px] text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded border border-border/40", className)}>
        0h
      </span>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/30 border border-border/50 text-[10px] font-mono text-muted-foreground transition-colors shrink-0",
        className,
      )}
    >
      {plan > 0 && (
        <span title="Planned Target Hours" className="text-muted-foreground/80 font-medium">
          Plan: <span className="text-foreground/90 font-semibold">{formatHoursMins(plan)}</span>
        </span>
      )}
      {plan > 0 && (logged > 0 || sysHrs > 0) && <span className="text-border/60 text-[9px]">•</span>}
      {logged > 0 && (
        <span title="User Logged Hours" className="text-muted-foreground/80 font-medium">
          Logged: <span className="text-emerald-400/90 font-semibold">{formatHoursMins(logged)}</span>
        </span>
      )}
      {logged > 0 && sysHrs > 0 && <span className="text-border/60 text-[9px]">•</span>}
      {sysHrs > 0 && (
        <span title="System Auto-Tracked Timer" className="text-muted-foreground/80 font-medium">
          Timer: <span className="text-amber-400/90 font-semibold">{formatHoursMins(sysHrs)}</span>
        </span>
      )}
      {hasGap && (
        <span
          title={`Gap > 1h between timer (${formatHoursMins(sysHrs)}) and logged hours (${formatHoursMins(logged)})`}
          className="text-rose-400 ml-0.5 font-bold text-[9px]"
        >
          ⚠️ Gap
        </span>
      )}
      {isOverrun && (
        <span
          title={`Overrun: plan ${plan}h, actual ${logged || sysHrs}h`}
          className="text-amber-400 ml-0.5 font-bold text-[9px]"
        >
          🚨 Overrun
        </span>
      )}
    </div>
  );
}

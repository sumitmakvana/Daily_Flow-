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

export function TaskHoursBadges({ task, variant = "capsule", className }: TaskHoursBadgesProps) {
  const plan = task.planned_hours ?? 0;
  const logged = task.actual_hours ?? 0;
  const sysHrs = task.started_at
    ? Math.min(8.0, Math.max(0, (Date.now() - new Date(task.started_at).getTime()) / 3600000))
    : Number(task.system_hours ?? 0);

  const hasGap = sysHrs > 0 && Math.abs(sysHrs - logged) >= 1.0;
  const isOverrun =
    (task.status === "In Progress" && (sysHrs >= 8.0 || (plan > 0 && sysHrs > plan))) ||
    (task.status === "Completed" && plan > 0 && (logged === 0 || logged > plan || logged >= 8.0));

  if (variant === "badges") {
    return (
      <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
        {plan > 0 && (
          <Badge variant="outline" className="bg-muted/40 text-muted-foreground border-border/80 text-[11px] font-mono font-medium shadow-2xs">
            🎯 Plan: <span className="text-indigo-300 font-bold ml-1">{formatHoursMins(plan)}</span>
          </Badge>
        )}
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/25 text-[11px] font-mono font-medium shadow-2xs">
          ✍️ Logged: <span className="font-bold ml-1">{formatHoursMins(logged)}</span>
        </Badge>
        {sysHrs > 0 && (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/25 text-[11px] font-mono font-medium shadow-2xs">
            ⏱️ Timer: <span className="font-bold ml-1">{formatHoursMins(sysHrs)}</span>
          </Badge>
        )}
        {hasGap && (
          <Badge variant="outline" className="bg-rose-500/15 text-rose-400 border-rose-500/30 text-[11px] font-mono font-bold shadow-2xs animate-pulse">
            ⚠️ Gap Alert
          </Badge>
        )}
        {isOverrun && (
          <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[11px] font-mono font-bold shadow-2xs animate-pulse">
            🚨 Overrun (&gt;{plan > 0 ? `${plan * 2}h` : "8h"})
          </Badge>
        )}
      </div>
    );
  }

  // Capsule variant (compact for task cards)
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/40 border border-border/60 text-[11px] font-mono text-muted-foreground shadow-2xs",
        className,
      )}
    >
      <span title="User Logged Hours" className="text-emerald-400/90 font-medium">
        Logged: {formatHoursMins(logged)}
      </span>
      {sysHrs > 0 && (
        <>
          <span className="text-border/80">|</span>
          <span title="System Auto-Tracked Timer" className="text-amber-400/90 font-medium flex items-center gap-0.5">
            Timer: {formatHoursMins(sysHrs)}
          </span>
        </>
      )}
      {plan > 0 && (
        <>
          <span className="text-border/80">|</span>
          <span title="Planned Target Hours" className="text-muted-foreground font-medium">
            Plan: {formatHoursMins(plan)}
          </span>
        </>
      )}
      {hasGap && (
        <span
          title={`Gap > 1h between system timer (${sysHrs}h) and logged hours (${logged}h)`}
          className="text-rose-400 ml-0.5 animate-pulse font-bold"
        >
          ⚠️
        </span>
      )}
      {isOverrun && (
        <span
          title={`Task exceeded estimated time: Plan ${plan}h, system/logged time ${sysHrs || logged}h`}
          className="text-amber-400 ml-0.5 font-bold animate-bounce"
        >
          🚨
        </span>
      )}
    </div>
  );
}

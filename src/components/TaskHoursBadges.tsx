import { useState } from "react";
import { formatHoursMins } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaskWorklog } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar, Clock, AlertTriangle, AlertCircle } from "lucide-react";

export interface TaskHoursData {
  planned_hours?: number | null;
  actual_hours?: number | null;
  started_at?: string | null;
  system_hours?: number | null;
  today_system_hours?: number | null;
  worklogs?: TaskWorklog[];
  status?: string | null;
}

interface TaskHoursBadgesProps {
  task: TaskHoursData;
  variant?: "capsule" | "badges";
  className?: string;
}

export function TaskHoursBadges({ task, className }: TaskHoursBadgesProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const plan = task.planned_hours ?? 0;
  const logged = task.actual_hours ?? 0;
  const baseSys = Number(task.system_hours ?? 0);

  const startTs = task.started_at ? new Date(task.started_at).getTime() : 0;
  const runningSys = task.started_at
    ? Math.min(8.0, Math.max(0, (Date.now() - startTs) / 3600000))
    : 0;
  const sysHrs = baseSys + runningSys;

  const todayBaseSys = Number(task.today_system_hours ?? 0);
  const midnightTodayTs = new Date().setHours(0, 0, 0, 0);
  const todayStartTs = task.started_at ? Math.max(startTs, midnightTodayTs) : 0;
  const runningTodaySys = task.started_at
    ? Math.min(8.0, Math.max(0, (Date.now() - todayStartTs) / 3600000))
    : 0;
  const todaySysHrs = todayBaseSys + runningTodaySys;

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

  const worklogs = task.worklogs || [];
  const timerTitle = todaySysHrs > 0 && sysHrs > todaySysHrs
    ? `Today: ${formatHoursMins(todaySysHrs)} • Total cumulative task time: ${formatHoursMins(sysHrs)}`
    : `Total System Auto-Tracked Timer: ${formatHoursMins(sysHrs)}`;

  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/30 border border-border/50 text-[10px] font-mono text-muted-foreground transition-colors max-w-full overflow-hidden",
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
        <div
          onMouseEnter={() => setPopoverOpen(true)}
          onMouseLeave={() => setPopoverOpen(false)}
          className="inline-flex items-center"
        >
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={timerTitle}
                onClick={(e) => {
                  e.stopPropagation();
                  setPopoverOpen((prev) => !prev);
                }}
                className="inline-flex items-center gap-1 text-muted-foreground/80 font-medium hover:text-foreground focus:outline-none cursor-pointer"
              >
                {todaySysHrs > 0 && sysHrs > todaySysHrs ? (
                  <>
                    Today: <span className="text-amber-400/90 font-semibold">{formatHoursMins(todaySysHrs)}</span>
                    <span className="text-muted-foreground/60 text-[9px]">(Total: {formatHoursMins(sysHrs)})</span>
                  </>
                ) : (
                  <>
                    Timer: <span className="text-amber-400/90 font-semibold">{formatHoursMins(sysHrs)}</span>
                  </>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="center"
              sideOffset={6}
              collisionPadding={16}
              className="z-[999999] w-64 p-3 bg-popover border border-border text-foreground text-xs shadow-2xl rounded-lg pointer-events-auto"
            >
              <div className="flex items-center justify-between font-semibold border-b border-border/60 pb-1.5 mb-2 text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" /> Time Breakdown
                </span>
                <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">Total: {formatHoursMins(sysHrs)}</span>
              </div>
              <div className="space-y-1 text-[11px] font-mono">
                <div className="flex items-center justify-between text-foreground">
                  <span className="text-muted-foreground">Today's Active Session:</span>
                  <span className="font-semibold text-amber-400">{formatHoursMins(todaySysHrs)}</span>
                </div>
                {sysHrs > todaySysHrs && (
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Previous Days Combined:</span>
                    <span>{formatHoursMins(sysHrs - todaySysHrs)}</span>
                  </div>
                )}
              </div>
              {worklogs.length > 0 && (
                <div className="mt-2.5 pt-2 border-t border-border/40 space-y-1">
                  <div className="text-[10px] font-sans font-semibold text-muted-foreground/80 uppercase tracking-wider mb-1">
                    Daily History Log
                  </div>
                  {worklogs.slice(0, 5).map((w) => (
                    <div key={w.id || w.work_date} className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-muted-foreground/60" /> {w.work_date}
                      </span>
                      <span>{formatHoursMins(Number(w.system_hours || 0))}</span>
                    </div>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      )}
      {hasGap && (
        <span
          title={`Gap > 1.5h between auto-timer (${formatHoursMins(sysHrs)}) and user logged hours (${formatHoursMins(logged)})`}
          className="text-amber-400/90 ml-0.5 font-medium text-[10px] inline-flex items-center gap-1"
        >
          <AlertTriangle className="h-3 w-3 text-amber-400/90" /> Gap
        </span>
      )}
      {isOverrun && (
        <span
          title={`Overrun: Planned ${plan}h target exceeded by total spent ${formatHoursMins(logged || sysHrs)}`}
          className="text-rose-400/90 ml-0.5 font-medium text-[10px] inline-flex items-center gap-1"
        >
          <AlertCircle className="h-3 w-3 text-rose-400/90" /> Overrun
        </span>
      )}
    </div>
  );
}

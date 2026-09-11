import { useState, useEffect } from "react";
import { formatHoursMins, toLocalISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaskWorklog } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar, Clock, AlertTriangle, AlertCircle, Play, Pause, BarChart2, Layers } from "lucide-react";

export interface TaskHoursData {
  id?: string;
  planned_hours?: number | null;
  actual_hours?: number | null;
  started_at?: string | null;
  system_hours?: number | null;
  today_system_hours?: number | null;
  worklogs?: TaskWorklog[];
  status?: string | null;
  created_at?: string | null;
}

interface TaskHoursBadgesProps {
  task: TaskHoursData;
  variant?: "capsule" | "badges";
  className?: string;
  onToggleTimer?: () => void;
}

function formatHHMMSS(totalSecs: number): string {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = Math.floor(totalSecs % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

import { useAuth } from "@/hooks/use-auth";

export function TaskHoursBadges({ task, className, onToggleTimer }: TaskHoursBadgesProps) {
  const { isManager, isAdmin } = useAuth();
  const isManagerOrAdmin = isManager || isAdmin;

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  // Live tick effect when timer is active
  useEffect(() => {
    if (!task.started_at) return;
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [task.started_at]);

  const plan = task.planned_hours ?? 0;
  const logged = task.actual_hours ?? 0;
  const baseSys = Number(task.system_hours ?? 0);

  const midnightTodayTs = new Date().setHours(0, 0, 0, 0);

  let runningPrevHrs = 0;
  let runningTodayHrs = 0;

  if (task.started_at) {
    const startTs = new Date(task.started_at).getTime();
    if (startTs < midnightTodayTs) {
      runningPrevHrs = Math.max(0, (midnightTodayTs - startTs) / 3600000);
      runningTodayHrs = Math.max(0, (nowMs - midnightTodayTs) / 3600000);
    } else {
      runningPrevHrs = 0;
      runningTodayHrs = Math.max(0, (nowMs - startTs) / 3600000);
    }
  }

  const runningSys = runningPrevHrs + runningTodayHrs;
  const sysHrs = baseSys + runningSys;

  const totalLiveSecs = Math.round(baseSys * 3600 + (task.started_at ? (nowMs - new Date(task.started_at).getTime()) / 1000 : 0));

  const worklogs = task.worklogs || [];
  const todayStr = toLocalISO(new Date());
  const isCreatedToday = task.created_at ? toLocalISO(new Date(task.created_at)) === todayStr : false;

  let prevWorklogSys = 0;
  if (isCreatedToday) {
    prevWorklogSys = 0;
  } else if (task.today_system_hours !== undefined && task.today_system_hours !== null) {
    const todayBase = Number(task.today_system_hours);
    prevWorklogSys = Math.max(0, baseSys - todayBase);
  } else if (worklogs.length > 0) {
    const prevLogs = worklogs.filter((w) => w.work_date < todayStr);
    prevWorklogSys = prevLogs.reduce((sum, w) => sum + Number(w.system_hours || 0), 0);
  } else {
    prevWorklogSys = 0;
  }

  prevWorklogSys = Math.min(baseSys, Math.max(0, prevWorklogSys));

  const previousDaysSysHrs = Math.min(sysHrs, Math.max(0, prevWorklogSys + runningPrevHrs));
  const todaySysHrs = Math.max(0, sysHrs - previousDaysSysHrs);

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
                title={popoverOpen ? undefined : timerTitle}
                onClick={(e) => {
                  e.stopPropagation();
                  setPopoverOpen((prev) => !prev);
                }}
                className="inline-flex items-center gap-1 text-muted-foreground/80 font-medium hover:text-foreground focus:outline-none cursor-pointer"
              >
                {previousDaysSysHrs > 0.001 ? (
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
              collisionPadding={12}
              className="z-[999999] w-72 max-w-[calc(100vw-1.5rem)] p-3 bg-[#16171d] border border-[#2b2d38] text-foreground text-xs shadow-2xl rounded-2xl pointer-events-auto backdrop-blur-md"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border/50 pb-1.5 mb-2">
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-xs text-foreground">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    Time Breakdown
                  </div>
                  <div className="text-[10px] text-muted-foreground">Track time spent on this task</div>
                </div>
                <span className="font-mono text-[10px] font-semibold bg-muted px-2 py-0.5 rounded-full border border-border/50">
                  Total: {formatHoursMins(sysHrs)}
                </span>
              </div>

              {/* Live Stopwatch Ring Widget */}
              <div className="relative flex flex-col items-center justify-center p-2.5 my-1.5 bg-[#101116] rounded-xl border border-border/40">
                <div className="relative w-28 h-28 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      className="stroke-muted/20"
                      strokeWidth="5"
                      fill="transparent"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      className={cn(
                        "transition-all duration-500",
                        task.started_at ? "stroke-emerald-400" : "stroke-amber-400/60"
                      )}
                      strokeWidth="5"
                      strokeDasharray={251}
                      strokeDashoffset={task.started_at ? 0 : 50}
                      strokeLinecap="round"
                      fill="transparent"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold mb-1",
                      task.started_at
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 animate-pulse"
                        : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    )}>
                      <span className={cn("w-1.5 h-1.5 rounded-full", task.started_at ? "bg-emerald-400" : "bg-amber-400")} />
                      {task.started_at ? "Active" : "Paused"}
                    </span>
                    
                    <span className="font-mono text-base font-bold tracking-tight text-foreground">
                      {formatHHMMSS(totalLiveSecs)}
                    </span>

                    {onToggleTimer && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleTimer();
                        }}
                        className="mt-1 p-1 rounded-full bg-muted/60 hover:bg-accent text-foreground transition-colors cursor-pointer"
                        title={task.started_at ? "Pause Timer" : "Start Timer"}
                      >
                        {task.started_at ? <Pause className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-emerald-400" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Stat Cards */}
              <div className="grid grid-cols-3 gap-1.5 mt-2">
                <div className="p-1.5 rounded-lg bg-card/60 border border-border/40 text-center">
                  <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1 mb-0.5">
                    <Clock className="w-3 h-3 text-amber-400" /> Today
                  </div>
                  <div className="font-mono text-xs font-semibold text-amber-400">{formatHoursMins(todaySysHrs)}</div>
                </div>
                <div className="p-1.5 rounded-lg bg-card/60 border border-border/40 text-center">
                  <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1 mb-0.5">
                    <Calendar className="w-3 h-3 text-blue-400" /> Prev Days
                  </div>
                  <div className="font-mono text-xs font-semibold text-muted-foreground">{formatHoursMins(previousDaysSysHrs)}</div>
                </div>
                <div className="p-1.5 rounded-lg bg-card/60 border border-border/40 text-center">
                  <div className="text-[10px] text-muted-foreground flex items-center justify-center gap-1 mb-0.5">
                    <Layers className="w-3 h-3 text-emerald-400" /> Total
                  </div>
                  <div className="font-mono text-xs font-semibold text-foreground">{formatHoursMins(sysHrs)}</div>
                </div>
              </div>
              {/* Manager Audit: Target vs Logged (visible for Managers & Admins only) */}
              {isManagerOrAdmin && (plan > 0 || logged > 0 || hasGap || isOverrun) && (
                <div className="mt-2 pt-2 border-t border-border/40 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <span>Audit Breakdown</span>
                    {isOverrun && (
                      <span className="text-rose-400 font-mono font-bold text-[9px] bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                        Overrun
                      </span>
                    )}
                    {!isOverrun && hasGap && (
                      <span className="text-amber-400 font-mono font-bold text-[9px] bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                        Gap Notice
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                    <div className="p-1 rounded bg-muted/20 border border-border/30">
                      <span className="text-muted-foreground block text-[9px]">Target Plan</span>
                      <span className="font-semibold text-foreground">{plan > 0 ? formatHoursMins(plan) : "—"}</span>
                    </div>
                    <div className="p-1 rounded bg-muted/20 border border-border/30">
                      <span className="text-muted-foreground block text-[9px]">User Logged</span>
                      <span className="font-semibold text-emerald-400">{logged > 0 ? formatHoursMins(logged) : "0h"}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Worklog History List (visible for Managers & Admins only) */}
              {isManagerOrAdmin && worklogs.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/40 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                    <span>Daily History Log</span>
                    <span className="font-mono text-[9px] text-muted-foreground/80">{worklogs.length} days</span>
                  </div>
                  <div className="space-y-1 max-h-24 overflow-y-auto pr-0.5">
                    {worklogs.slice(0, 5).map((w) => (
                      <div key={w.id || w.work_date} className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-muted-foreground/60" /> {w.work_date}
                        </span>
                        <span className="font-medium text-foreground">{formatHoursMins(Number(w.system_hours || 0))}</span>
                      </div>
                    ))}
                  </div>
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


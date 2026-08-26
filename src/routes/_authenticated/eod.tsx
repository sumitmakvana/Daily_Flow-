import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  CheckCircle2,
  Circle,
  AlertOctagon,
  Clock,
  ArrowRightCircle,
  Search,
  Users,
  Calendar,
  Sparkles,
  ChevronRight,
  RefreshCw,
  MessageSquare,
  Columns,
  Table as TableIcon,
  CheckCircle,
  Hourglass,
  ArrowUpRight,
} from "lucide-react";
import type { Profile, EodCheckin, Task, Project } from "@/lib/types";
import { todayISO, formatHoursMins } from "@/lib/format";
import { eodService } from "@/services/eod";
import { workloadService, utilTone } from "@/services/workload";
import { carryForwardService } from "@/services/carry-forward";
import { toast } from "sonner";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
import { ExecutiveMemberInspectionDrawer } from "./executive";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/eod")({
  component: EodBoardPage,
});

function EodBoardPage() {
  const { user, isManager } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [checkins, setCheckins] = useState<EodCheckin[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);

  // View & Filter State
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"split" | "table">("split");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [inspectedTask, setInspectedTask] = useState<Task | null>(null);

  const load = async () => {
    try {
      const [{ data: p }, c, { data: t }, { data: proj }] = await Promise.all([
        supabase.from("profiles").select("id,display_name,email,avatar_url,team_id,manager_id"),
        eodService.listForDate(todayISO()),
        supabase.from("tasks").select("*"),
        supabase.from("projects").select("*"),
      ]);
      setProfiles((p ?? []) as Profile[]);
      setCheckins(c ?? []);
      setTasks((t ?? []) as Task[]);
      setProjects((proj ?? []) as Project[]);
    } catch (err) {
      console.error("Failed to load EOD board data:", err);
    }
  };

  useEffect(() => {
    load();
  }, []);
  useRealtimeTasks(load, "eod-board-rt");

  const todayStr = todayISO();
  const utils = workloadService.computeToday(tasks);
  const submittedMap = useMemo(() => new Map(checkins.map((c) => [c.user_id, c])), [checkins]);

  // Derived KPIs
  const kpis = useMemo(() => {
    const totalMembers = profiles.length;
    const submittedCount = checkins.length;
    const pendingSubmissionCount = Math.max(0, totalMembers - submittedCount);
    const submissionRate = totalMembers > 0 ? Math.round((submittedCount / totalMembers) * 100) : 0;

    const completedTodayTasks = tasks.filter((t) => {
      if (t.status !== "Completed") return false;
      const completedDay = t.completed_at ? t.completed_at.slice(0, 10) : "";
      return completedDay === todayStr;
    });

    const completedCount = completedTodayTasks.length;
    const totalActiveTasks = tasks.filter((t) => t.status !== "Completed" && t.status !== "On Hold").length;
    const totalBlockers = tasks.filter((t) => t.status === "Blocked").length;

    return {
      totalMembers,
      submittedCount,
      pendingSubmissionCount,
      submissionRate,
      completedCount,
      totalActiveTasks,
      totalBlockers,
    };
  }, [profiles, checkins, tasks, todayStr]);

  // Split into Submitted vs Pending lists
  const { submittedMembers, pendingMembers } = useMemo(() => {
    const submitted: Profile[] = [];
    const pending: Profile[] = [];

    profiles.forEach((p) => {
      const matchSearch =
        !search.trim() ||
        (p.display_name && p.display_name.toLowerCase().includes(search.toLowerCase())) ||
        (p.email && p.email.toLowerCase().includes(search.toLowerCase()));

      if (!matchSearch) return;

      if (submittedMap.has(p.id)) {
        submitted.push(p);
      } else {
        pending.push(p);
      }
    });

    return { submittedMembers: submitted, pendingMembers: pending };
  }, [profiles, submittedMap, search]);

  // Bulk carry forward all members
  const runCarryForwardAll = async () => {
    if (!user) return;
    setBusy(true);
    let total = 0;
    let failed = 0;
    for (const p of profiles) {
      const res = await carryForwardService.carryAllOverdue(user.id, p.id);
      total += res.ok;
      failed += res.failed;
    }
    setBusy(false);
    toast.success(
      `Carried forward ${total} incomplete task${total === 1 ? "" : "s"} to tomorrow${failed ? ` · ${failed} failed` : ""}`,
    );
    load();
  };

  // Individual member carry forward
  const runCarryForwardSingle = async (memberId: string, memberName: string) => {
    if (!user) return;
    setBusy(true);
    const res = await carryForwardService.carryAllOverdue(user.id, memberId);
    setBusy(false);
    if (res.ok > 0) {
      toast.success(`Carried forward ${res.ok} task(s) for ${memberName} to tomorrow!`);
    } else {
      toast.info(`No overdue or pending tasks to carry forward for ${memberName}.`);
    }
    load();
  };

  const snapshot = async () => {
    setBusy(true);
    try {
      const n = await workloadService.snapshotToday(tasks);
      toast.success(`Daily snapshot saved for ${n} member${n === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-5 py-4 space-y-5">
      {/* Header & Evening Sign-Off Hero Bar */}
      <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
              <Calendar className="h-6 w-6 text-primary" /> End-of-Day (EOD) Sign-Off
            </h1>
            <Badge variant="outline" className="text-xs px-2.5 py-0.5 bg-primary/10 text-primary border-primary/30 font-mono font-semibold">
              Today: {todayStr}
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Daily evening checklist: Review member check-ins, verify remaining tasks, and roll over incomplete work to tomorrow.
          </p>
        </div>

        {isManager && (
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={snapshot}
              disabled={busy}
              className="h-9 text-xs font-semibold gap-1.5 px-3"
            >
              <Sparkles className="h-4 w-4 text-primary" /> Save Snapshot
            </Button>
            <Button
              size="sm"
              onClick={runCarryForwardAll}
              disabled={busy}
              className="h-9 text-xs font-semibold gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm px-3.5"
            >
              <ArrowRightCircle className="h-4 w-4" /> Carry Forward All Tasks
            </Button>
          </div>
        )}
      </div>

      {/* Progress & Quick Stats Ribbon */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-3.5 shadow-xs space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>EOD Progress</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-emerald-400">
            {kpis.submittedCount} <span className="text-xs text-muted-foreground font-normal">/ {kpis.totalMembers}</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {kpis.submissionRate}% team checked-in today
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-3.5 shadow-xs space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>Tasks Done Today</span>
            <CheckCircle className="h-4 w-4 text-blue-400" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-blue-400">
            {kpis.completedCount}
          </div>
          <div className="text-[10px] text-muted-foreground">Completed today</div>
        </div>

        <div className="bg-card border border-border rounded-xl p-3.5 shadow-xs space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span>Incomplete Tasks</span>
            <Hourglass className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono text-amber-400">
            {kpis.totalActiveTasks}
          </div>
          <div className="text-[10px] text-muted-foreground">Pending / In Progress</div>
        </div>

        <div className={cn(
          "border rounded-xl p-3.5 shadow-xs space-y-1",
          kpis.totalBlockers > 0 ? "bg-rose-500/10 border-rose-500/30" : "bg-card border-border"
        )}>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <span className={kpis.totalBlockers > 0 ? "text-rose-400 font-bold" : ""}>Blockers</span>
            <AlertOctagon className="h-4 w-4 text-rose-400" />
          </div>
          <div className={cn("text-xl sm:text-2xl font-bold font-mono", kpis.totalBlockers > 0 ? "text-rose-400" : "text-foreground")}>
            {kpis.totalBlockers}
          </div>
          <div className={cn("text-[10px]", kpis.totalBlockers > 0 ? "text-rose-400" : "text-muted-foreground")}>
            {kpis.totalBlockers > 0 ? "Blocked tasks require help" : "No blockers reported"}
          </div>
        </div>
      </div>

      {/* Toolbar: Search & View Toggle */}
      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="relative w-full max-w-sm flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search member by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs bg-input/40 border-border text-foreground placeholder:text-muted-foreground/60 rounded-md"
          />
        </div>

        <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border">
          <Button
            size="sm"
            variant={viewMode === "split" ? "default" : "ghost"}
            onClick={() => setViewMode("split")}
            className={cn("h-7 text-xs px-2.5 gap-1.5 rounded-md", viewMode === "split" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}
          >
            <Columns className="h-3.5 w-3.5" /> Split Board
          </Button>
          <Button
            size="sm"
            variant={viewMode === "table" ? "default" : "ghost"}
            onClick={() => setViewMode("table")}
            className={cn("h-7 text-xs px-2.5 gap-1.5 rounded-md", viewMode === "table" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground")}
          >
            <TableIcon className="h-3.5 w-3.5" /> Table View
          </Button>
        </div>
      </div>

      {/* Main Board View */}
      {viewMode === "split" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {/* Section 1: Pending EOD Submission */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-amber-400 ring-4 ring-amber-400/20" />
                <h2 className="text-sm font-bold text-foreground">
                  Pending EOD Check-in ({pendingMembers.length})
                </h2>
              </div>
              <span className="text-xs text-muted-foreground">Waiting for submission</span>
            </div>

            <div className="space-y-2.5">
              {pendingMembers.map((p) => {
                const u = utils.get(p.id);
                const tone = u ? utilTone(u.planned_hours) : null;
                const memberTasks = tasks.filter((t) => t.assigned_to === p.id);
                const pendingTasks = memberTasks.filter((t) => t.status !== "Completed" && t.status !== "On Hold");
                const blockerTasks = memberTasks.filter((t) => t.status === "Blocked");

                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedMemberId(p.id)}
                    className="bg-card border border-border hover:border-primary/40 rounded-xl p-3.5 space-y-3 shadow-xs hover:shadow-md transition-all cursor-pointer group/card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-9 w-9 border border-border shrink-0">
                          {p.avatar_url ? (
                            <AvatarImage src={p.avatar_url} alt={p.display_name} />
                          ) : (
                            <AvatarFallback className="bg-primary/20 text-foreground text-xs font-bold">
                              {p.display_name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          )}
                        </Avatar>
                        <div>
                          <div className="font-semibold text-sm text-foreground group-hover/card:text-primary transition-colors">
                            {p.display_name}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{p.email}</div>
                        </div>
                      </div>

                      <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-amber-500/10 text-amber-400 border-amber-500/30 font-medium">
                        ⏳ Pending
                      </Badge>
                    </div>

                    {/* Workload snapshot */}
                    <div className="grid grid-cols-3 gap-2 bg-muted/30 p-2 rounded-lg text-center text-xs">
                      <div>
                        <div className="text-muted-foreground text-[10px]">Open Tasks</div>
                        <div className="font-mono font-bold text-foreground">{pendingTasks.length}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[10px]">Est. Hours</div>
                        <div className="font-mono font-bold text-foreground">{u?.planned_hours ?? 0}h</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[10px]">Blockers</div>
                        <div className={cn("font-mono font-bold", blockerTasks.length > 0 ? "text-rose-400" : "text-muted-foreground")}>
                          {blockerTasks.length}
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center justify-between pt-1 text-xs">
                      {tone && (
                        <span className={cn("inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-medium", tone.className)}>
                          {tone.label}
                        </span>
                      )}

                      <div className="flex items-center gap-1.5 ml-auto">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            runCarryForwardSingle(p.id, p.display_name);
                          }}
                          className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                          title="Shift incomplete tasks to tomorrow"
                        >
                          <ArrowRightCircle className="h-3 w-3 mr-1" /> Carry Forward
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMemberId(p.id);
                          }}
                          className="h-7 text-xs px-2.5 gap-1 text-primary border-primary/30 hover:bg-primary/10"
                        >
                          Inspect <ArrowUpRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {pendingMembers.length === 0 && (
                <div className="bg-card border border-border/80 rounded-xl p-8 text-center text-xs text-muted-foreground italic">
                  🎉 All team members have submitted their EOD reports today!
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Submitted & Verified EOD */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20" />
                <h2 className="text-sm font-bold text-foreground">
                  Submitted EOD Reports ({submittedMembers.length})
                </h2>
              </div>
              <span className="text-xs text-muted-foreground">EOD check-ins received</span>
            </div>

            <div className="space-y-2.5">
              {submittedMembers.map((p) => {
                const c = submittedMap.get(p.id);
                const u = utils.get(p.id);
                const memberTasks = tasks.filter((t) => t.assigned_to === p.id);
                const completedToday = memberTasks.filter((t) => t.status === "Completed" && t.completed_at?.slice(0, 10) === todayStr);

                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedMemberId(p.id)}
                    className="bg-card border border-border hover:border-emerald-500/40 rounded-xl p-3.5 space-y-3 shadow-xs hover:shadow-md transition-all cursor-pointer group/card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="h-9 w-9 border border-border shrink-0">
                          {p.avatar_url ? (
                            <AvatarImage src={p.avatar_url} alt={p.display_name} />
                          ) : (
                            <AvatarFallback className="bg-emerald-500/20 text-emerald-400 text-xs font-bold">
                              {p.display_name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          )}
                        </Avatar>
                        <div>
                          <div className="font-semibold text-sm text-foreground group-hover/card:text-primary transition-colors">
                            {p.display_name}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{p.email}</div>
                        </div>
                      </div>

                      <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-medium flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Submitted
                      </Badge>
                    </div>

                    {/* Member's Submitted EOD Note */}
                    {c?.note && (
                      <div className="bg-muted/40 border border-border/80 rounded-lg p-2.5 text-xs text-foreground flex items-start gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                        <p className="italic text-muted-foreground leading-relaxed">{c.note}</p>
                      </div>
                    )}

                    {/* Summary stats */}
                    <div className="grid grid-cols-3 gap-2 bg-muted/30 p-2 rounded-lg text-center text-xs">
                      <div>
                        <div className="text-muted-foreground text-[10px]">Done Today</div>
                        <div className="font-mono font-bold text-emerald-400">{c?.completed_count ?? completedToday.length}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[10px]">Remaining</div>
                        <div className="font-mono font-bold text-foreground">{c?.pending_count ?? u?.active ?? 0} ({c?.remaining_hours ?? u?.planned_hours ?? 0}h)</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-[10px]">Blockers</div>
                        <div className={cn("font-mono font-bold", (c?.blocker_count ?? 0) > 0 ? "text-rose-400" : "text-muted-foreground")}>
                          {c?.blocker_count ?? 0}
                        </div>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center justify-between pt-1 text-xs">
                      <span className="text-[10px] text-muted-foreground font-mono">
                        Date: {(c?.checkin_date as any) instanceof Date ? (c?.checkin_date as any).toISOString().slice(0, 10) : String(c?.checkin_date || todayStr)}
                      </span>

                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            runCarryForwardSingle(p.id, p.display_name);
                          }}
                          className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                          title="Shift incomplete tasks to tomorrow"
                        >
                          <ArrowRightCircle className="h-3 w-3 mr-1" /> Carry Forward
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMemberId(p.id);
                          }}
                          className="h-7 text-xs px-2.5 gap-1 text-primary border-primary/30 hover:bg-primary/10"
                        >
                          Inspect <ArrowUpRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {submittedMembers.length === 0 && (
                <div className="bg-card border border-border/80 rounded-xl p-8 text-center text-xs text-muted-foreground italic">
                  No EOD reports submitted yet for today.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Full Table View */
        <Card className="p-0 overflow-hidden border border-border shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground uppercase tracking-wider text-[11px]">
                  <th className="text-left py-3 px-4 font-semibold">Team Member</th>
                  <th className="text-left py-3 px-3.5 font-semibold">EOD Status</th>
                  <th className="text-center py-3 px-3.5 font-semibold">Done Today</th>
                  <th className="text-center py-3 px-3.5 font-semibold">Pending</th>
                  <th className="text-center py-3 px-3.5 font-semibold">Blockers</th>
                  <th className="text-left py-3 px-3.5 font-semibold">Remaining Hours</th>
                  <th className="text-left py-3 px-3.5 font-semibold">Submitted Notes</th>
                  <th className="text-right py-3 px-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {profiles
                  .filter(
                    (p) =>
                      !search.trim() ||
                      p.display_name.toLowerCase().includes(search.toLowerCase()) ||
                      (p.email && p.email.toLowerCase().includes(search.toLowerCase())),
                  )
                  .map((p) => {
                    const c = submittedMap.get(p.id);
                    const u = utils.get(p.id);
                    const isSubmitted = !!c;

                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedMemberId(p.id)}
                        className="hover:bg-muted/40 transition-colors cursor-pointer group/row"
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <Avatar className="h-8 w-8 border border-border shrink-0">
                              {p.avatar_url ? (
                                <AvatarImage src={p.avatar_url} alt={p.display_name} />
                              ) : (
                                <AvatarFallback className="bg-primary/20 text-foreground text-xs font-bold">
                                  {p.display_name.slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <div>
                              <div className="font-semibold text-foreground group-hover/row:text-primary transition-colors">
                                {p.display_name}
                              </div>
                              <div className="text-[10px] text-muted-foreground">{p.email}</div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3.5">
                          {isSubmitted ? (
                            <Badge variant="outline" className="text-[10px] px-2 py-0.5 border-emerald-500/30 text-emerald-400 bg-emerald-500/10 font-medium">
                              🟢 Submitted
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-2 py-0.5 border-border text-muted-foreground bg-muted/40 font-medium">
                              ⏳ Pending
                            </Badge>
                          )}
                        </td>

                        <td className="py-3 px-3.5 text-center font-mono font-bold text-emerald-400">
                          {c?.completed_count ?? u?.completed ?? 0}
                        </td>

                        <td className="py-3 px-3.5 text-center font-mono font-bold text-amber-400">
                          {c?.pending_count ?? u?.active ?? 0}
                        </td>

                        <td className="py-3 px-3.5 text-center font-mono font-bold">
                          {(c?.blocker_count ?? u?.blocked ?? 0) > 0 ? (
                            <span className="text-rose-400 bg-rose-500/10 border border-rose-500/30 px-1.5 py-0.5 rounded text-[11px]">
                              {c?.blocker_count ?? u?.blocked}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">0</span>
                          )}
                        </td>

                        <td className="py-3 px-3.5 font-mono text-muted-foreground">
                          <span className="text-foreground font-semibold">
                            {c?.remaining_hours ?? u?.planned_hours ?? 0}h
                          </span>
                        </td>

                        <td className="py-3 px-3.5 max-w-xs truncate text-muted-foreground italic">
                          {c?.note || "—"}
                        </td>

                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                runCarryForwardSingle(p.id, p.display_name);
                              }}
                              className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                            >
                              Carry Forward
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedMemberId(p.id);
                              }}
                              className="h-7 text-xs px-2 text-primary border-primary/30"
                            >
                              Inspect
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Full Member Inspection Drawer */}
      {selectedMemberId && (
        <ExecutiveMemberInspectionDrawer
          memberId={selectedMemberId}
          onClose={() => setSelectedMemberId(null)}
          profiles={profiles}
          tasks={tasks}
          projects={projects}
          checkins={checkins}
        />
      )}

      {/* Universal Task Inspection Dialog */}
      {inspectedTask && (
        <TaskDetailModal
          task={inspectedTask}
          open={!!inspectedTask}
          onOpenChange={(open) => {
            if (!open) setInspectedTask(null);
          }}
          assignedProfile={profiles.find((p) => p.id === inspectedTask.assigned_to) || null}
        />
      )}
    </div>
  );
}

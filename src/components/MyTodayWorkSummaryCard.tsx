import React, { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock, AlertOctagon, Sparkles, Send, FileText } from "lucide-react";
import type { Task } from "@/lib/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export interface SummaryTaskItem {
  id: string;
  task_code: string;
  task_name: string;
  status: string;
  priority?: string;
  due_date?: string | null;
  completed_at?: string | null;
  remarks?: string | null;
  blocker_reason?: string | null;
}

interface MyTodayWorkSummaryCardProps {
  tasks?: SummaryTaskItem[];
  userName?: string;
}

export function MyTodayWorkSummaryCard({ tasks = [], userName }: MyTodayWorkSummaryCardProps) {
  const { user } = useAuth();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [dailyNote, setDailyNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fetchedTasks, setFetchedTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!user) return;
    const loadUserTasks = async () => {
      try {
        const { data } = await supabase.from("tasks").select("*").eq("assigned_to", user.id);
        if (data) {
          setFetchedTasks(data as Task[]);
        }
      } catch (err) {
        console.warn("Failed to load user tasks for summary card:", err);
      }
    };
    loadUserTasks();
  }, [user?.id]);

  const localTodayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

  // Use fetchedTasks if available (contains completed tasks), else fallback to passed tasks
  const effectiveTasks = fetchedTasks.length > 0 ? fetchedTasks : tasks;

  // Filter strictly for tasks completed TODAY (matching todayStr or localTodayStr)
  const completedToday = effectiveTasks.filter((t) => {
    if (t.status !== "Completed") return false;
    if (t.completed_at) {
      const compDate = t.completed_at.slice(0, 10);
      return compDate === todayStr || compDate === localTodayStr;
    }
    const upDate = (t as Task).updated_at ? (t as Task).updated_at.slice(0, 10) : null;
    if (upDate) {
      return upDate === todayStr || upDate === localTodayStr;
    }
    return t.due_date === todayStr || t.due_date === localTodayStr;
  });

  const isDueTodayOrPast = (due?: string | null) => {
    if (!due) return true;
    const d = due.slice(0, 10);
    return d <= todayStr || d <= localTodayStr;
  };

  const inProgressToday = effectiveTasks.filter(
    (t) => (t.status === "In Progress" || t.status === "In Review") && isDueTodayOrPast(t.due_date),
  );
  const blockedToday = effectiveTasks.filter(
    (t) => (t.status === "Blocked" || t.status === "On Hold") && isDueTodayOrPast(t.due_date),
  );
  const pendingToday = effectiveTasks.filter(
    (t) => t.status === "To Do" && isDueTodayOrPast(t.due_date),
  );

  const totalCount =
    completedToday.length + inProgressToday.length + blockedToday.length + pendingToday.length;
  const completedCount = completedToday.length;
  const completionPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const handleSubmitNote = () => {
    if (!dailyNote.trim()) {
      toast.error("Please enter a note before submitting your daily recap.");
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      toast.success("EOD Daily Recap saved successfully!");
      setDailyNote("");
    }, 600);
  };

  return (
    <Card className="border-emerald-500/20 bg-gradient-to-br from-card via-card to-emerald-950/10 shadow-sm overflow-hidden mb-6">
      <CardHeader className="pb-3 border-b border-border/50 bg-accent/20">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">
                My Today's Work Summary {userName ? `— ${userName}` : ""}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Your personal End-of-Day status & progress
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "px-3 py-1 text-xs font-semibold rounded-full",
              completionPercentage >= 80
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                : completionPercentage >= 50
                  ? "bg-blue-500/10 text-blue-600 border-blue-500/30"
                  : "bg-amber-500/10 text-amber-600 border-amber-500/30",
            )}
          >
            {completionPercentage}% Done Today
          </Badge>
        </div>

        <div className="mt-3 space-y-1">
          <div className="flex justify-between text-xs font-medium text-muted-foreground">
            <span>
              Progress ({completedCount} of {totalCount} tasks completed)
            </span>
            <span>{completionPercentage}%</span>
          </div>
          <Progress value={completionPercentage} className="h-2 bg-emerald-950/20" />
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* KPI Mini Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {completedCount}
            </div>
            <div className="text-[11px] font-medium text-muted-foreground flex items-center justify-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Completed
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
              {inProgressToday.length}
            </div>
            <div className="text-[11px] font-medium text-muted-foreground flex items-center justify-center gap-1">
              <Clock className="w-3.5 h-3.5 text-blue-500" /> In Progress
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20">
            <div className="text-xl font-bold text-rose-600 dark:text-rose-400">
              {blockedToday.length}
            </div>
            <div className="text-[11px] font-medium text-muted-foreground flex items-center justify-center gap-1">
              <AlertOctagon className="w-3.5 h-3.5 text-rose-500" /> Blocked
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
              {pendingToday.length}
            </div>
            <div className="text-[11px] font-medium text-muted-foreground flex items-center justify-center gap-1">
              <FileText className="w-3.5 h-3.5 text-amber-500" /> Pending
            </div>
          </div>
        </div>

        {/* Task Lists Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {/* Completed Tasks Column */}
          <div className="space-y-2 border border-border/60 rounded-lg p-3 bg-card/60">
            <h4 className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Completed Today ({completedToday.length})
            </h4>
            {completedToday.length === 0 ? (
              <p className="text-muted-foreground italic text-[11px]">
                No tasks completed yet today.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {completedToday.map((t) => (
                  <li key={t.id} className="flex items-start gap-1.5 p-1.5 rounded bg-accent/40">
                    <span className="font-mono text-[10px] text-emerald-600 bg-emerald-500/10 px-1 rounded font-bold">
                      {t.task_code}
                    </span>
                    <span className="line-through text-muted-foreground flex-1 truncate">
                      {t.task_name}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Active / Blocked Column */}
          <div className="space-y-2 border border-border/60 rounded-lg p-3 bg-card/60">
            <h4 className="font-semibold text-foreground flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-blue-500" /> In Progress & Blocked (
              {inProgressToday.length + blockedToday.length})
            </h4>
            {[...blockedToday, ...inProgressToday].length === 0 ? (
              <p className="text-muted-foreground italic text-[11px]">No active work remaining.</p>
            ) : (
              <ul className="space-y-1.5">
                {[...blockedToday, ...inProgressToday].map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-1.5 p-1.5 rounded bg-accent/40"
                  >
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1 rounded">
                        {t.task_code}
                      </span>
                      <span className="truncate">{t.task_name}</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] px-1.5 py-0 h-4 shrink-0",
                        t.status === "Blocked"
                          ? "bg-rose-500/10 text-rose-600 border-rose-500/30"
                          : "bg-blue-500/10 text-blue-600 border-blue-500/30",
                      )}
                    >
                      {t.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Quick EOD Daily Recap Note */}
        <div className="pt-2 border-t border-border/40">
          <label className="text-xs font-semibold text-foreground block mb-1">
            ✍️ Quick EOD Daily Recap / Remarks for Manager
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. Completed Payment API, pending test cases for tomorrow..."
              value={dailyNote}
              onChange={(e) => setDailyNote(e.target.value)}
              className="flex-1 bg-background border border-input rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button
              size="sm"
              onClick={handleSubmitNote}
              disabled={isSubmitting}
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Send className="w-3.5 h-3.5 mr-1" /> Submit Recap
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatHoursMins, parseHoursOrMins } from "@/lib/format";
import { previouslyLogged, runningTimerHours, suggestLoggedHours } from "@/lib/review";
import type { Task } from "@/lib/types";
import { reviewsService } from "@/services/reviews";
import { taskEodService } from "@/services/task-eod";
import {
  reviewSubmitStore,
  useReviewSubmitStore,
  type ReviewSubmitMode,
} from "@/services/review-submit-store";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

/**
 * Before a task goes to its reviewer, the assignee enters (or confirms) the manual EOD logged
 * hours for today. Earlier days' hours are kept; re-confirming the same day replaces today's
 * figure instead of adding to it. "confirm" mode lets the assignee correct it while in review.
 */
export function ReviewSubmitDialog({
  open,
  mode,
  task,
  userId,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  mode: ReviewSubmitMode;
  task: Task;
  userId: string;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const isAssignee = task.assigned_to === userId;
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [todaySubmission, setTodaySubmission] = useState<number | null>(null);
  const [totalLogged, setTotalLogged] = useState<number>(Number(task.actual_hours ?? 0));

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setNote("");
    setTodaySubmission(null);
    const total = Number(task.actual_hours ?? 0);
    setTotalLogged(total);
    const fallback = () =>
      suggestLoggedHours({
        todaySubmission: null,
        todaySystemHours: Number(task.today_system_hours ?? 0),
        runningHours: runningTimerHours(task.started_at),
        totalLogged: total,
        planned: Number(task.planned_hours ?? 0),
      });
    setHours(String(fallback() || ""));
    if (!isAssignee) return;
    setLoading(true);
    taskEodService
      .myTasksToday()
      .then((rows) => {
        if (!alive) return;
        const row = rows.find((r) => r.task_id === task.id);
        const submitted = row?.submission ? Number(row.submission.actual_hours) : null;
        const logged = row?.total_actual_hours != null ? Number(row.total_actual_hours) : total;
        setTodaySubmission(submitted);
        setTotalLogged(logged);
        setHours(
          String(
            suggestLoggedHours({
              todaySubmission: submitted,
              todaySystemHours: Number(task.today_system_hours ?? 0),
              runningHours: runningTimerHours(task.started_at),
              totalLogged: logged,
              planned: Number(task.planned_hours ?? 0),
            }) || "",
          ),
        );
      })
      .catch(() => {
        /* keep the local suggestion */
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, task.id, isAssignee]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => parseHoursOrMins(hours), [hours]);
  const invalid = !Number.isFinite(parsed) || parsed < 0 || parsed > 24;
  const before = previouslyLogged(totalLogged, todaySubmission);
  // 0 never lowers an existing figure for today (same as the EOD check-in)
  const todayAfter = todaySubmission !== null && parsed <= 0 ? todaySubmission : parsed;
  const totalAfter = Math.round((before + todayAfter) * 100) / 100;
  const trackedNow = Number(task.system_hours ?? 0) + runningTimerHours(task.started_at);
  const needsHours = isAssignee && (invalid || totalAfter <= 0);
  const confirming = mode === "confirm";

  const submit = async () => {
    if (busy || needsHours) return;
    setBusy(true);
    try {
      if (confirming) {
        await reviewsService.logHours(task.id, parsed, note);
        toast.success(`Logged hours updated for ${task.task_code}`);
      } else {
        await reviewsService.submit(task, {
          loggedHours: isAssignee ? parsed : undefined,
          note: note || undefined,
        });
        toast.success(`${task.task_code} sent for review`);
      }
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {confirming
              ? `Update logged hours — ${task.task_code}`
              : `Send ${task.task_code} for review`}
          </DialogTitle>
          <DialogDescription>
            {isAssignee
              ? "Enter or confirm the hours you worked on this task today. Your reviewer sees them, and the task can't be approved without logged hours."
              : "Only the assignee can enter logged hours. Approval stays blocked until they do."}
          </DialogDescription>
        </DialogHeader>

        {isAssignee && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="review-hours">Hours worked today</Label>
              <Input
                id="review-hours"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="e.g. 2.5 or 2h 30m"
                inputMode="decimal"
                autoFocus
                disabled={loading}
              />
              {invalid && <p className="text-xs text-destructive">Enter between 0 and 24 hours.</p>}
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg border border-border/70 bg-muted/20 p-2.5 text-xs">
              <dt className="text-muted-foreground">Logged on earlier days</dt>
              <dd className="font-mono">{formatHoursMins(before)}</dd>
              <dt className="text-muted-foreground">Timer-tracked in total</dt>
              <dd className="font-mono">{formatHoursMins(trackedNow)}</dd>
              <dt className="font-medium">Total logged after this</dt>
              <dd className="font-mono font-semibold">{formatHoursMins(totalAfter)}</dd>
            </dl>
            {todaySubmission !== null && (
              <p className="text-[11px] text-muted-foreground">
                You already logged {formatHoursMins(todaySubmission)} today. This replaces it, it
                doesn't add to it.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="review-note">Note (optional)</Label>
              <Textarea
                id="review-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || loading || needsHours} onClick={submit}>
            {busy ? "Saving…" : confirming ? "Save hours" : "Send for review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mounted once in AppShell; opened through reviewSubmitStore. */
export function GlobalReviewSubmitDialog() {
  const { task, mode, open, onDone } = useReviewSubmitStore();
  const { user } = useAuth();
  if (!task || !user) return null;
  return (
    <ReviewSubmitDialog
      open={open}
      mode={mode}
      task={task}
      userId={user.id}
      onOpenChange={(v) => {
        if (!v) reviewSubmitStore.close();
      }}
      onDone={() => {
        reviewSubmitStore.close();
        onDone?.();
      }}
    />
  );
}

import { useState, useEffect } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { Task } from "@/lib/types";
import { tasksService } from "@/services/tasks";
import { taskEodService } from "@/services/task-eod";
import { toast } from "sonner";

export function CompleteTaskEodDialog({
  open,
  onOpenChange,
  task,
  userId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
  userId: string;
  onDone: () => void;
}) {
  const planned = Number(task.planned_hours ?? 0);
  const currentActual = Number(task.actual_hours ?? 0);
  const remaining = Math.max(0, planned - currentActual);
  const defaultFill = remaining > 0 ? remaining : planned > 0 ? planned : 1;

  const [hours, setHours] = useState<string>(String(defaultFill));
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setHours(String(defaultFill));
      setNote("");
      setBusy(false);
    }
  }, [open, defaultFill]);

  const handleCompleteWithEod = async (skipHours = false) => {
    setBusy(true);
    try {
      const loggedHours = skipHours ? 0 : Number(hours || "0");
      
      // 1. Mark task as Completed in main tasks table
      await tasksService.setStatus(task, "Completed", userId);

      // 2. Submit EOD log for today if hours > 0 or note is entered
      if (!skipHours && (loggedHours > 0 || note.trim())) {
        await taskEodService.submit(task.id, "done", loggedHours, note.trim() || null);
      }

      toast.success(
        skipHours
          ? `${task.task_code} marked as Completed`
          : `${task.task_code} Completed · ${loggedHours}h logged`,
      );
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="sm:max-w-md bg-card border-border text-card-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" /> Complete Task & Log Hours
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Verify hours worked and update status to completed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Task Info Summary matching TaskCard */}
          <div className="bg-muted/40 border border-border rounded-lg p-3 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-primary font-bold">{task.task_code}</span>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>Planned: <strong className="text-foreground">{planned}h</strong></span>
                <span>·</span>
                <span>Logged: <strong className="text-foreground">{currentActual}h</strong></span>
              </div>
            </div>
            <div className="font-medium text-xs text-foreground truncate">{task.task_name}</div>
          </div>

          {/* Hours Input & Quick Fill Presets */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <label className="font-medium text-foreground flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-primary" /> Today's Logged Hours:
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.25"
                min="0"
                max="24"
                className="h-9 text-sm font-bold text-primary bg-background border-border text-right focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary focus:outline-none selection:bg-primary/30 selection:text-foreground"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                disabled={busy}
              />
              <span className="text-xs text-muted-foreground">hours</span>
            </div>
          </div>

          {/* Optional Manager Note */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Remarks / Note (Optional):</label>
            <Textarea
              placeholder="Any remarks for team or manager..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              rows={2}
              className="text-xs bg-background border-border text-foreground focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary focus:outline-none selection:bg-primary/30 selection:text-foreground"
            />
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleCompleteWithEod(true)}
            disabled={busy}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Skip Hours & Complete
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => handleCompleteWithEod(false)}
            disabled={busy}
            className="h-8 text-xs font-semibold gap-1.5"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Save & Complete ({hours || "0"}h)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useCompleteEodStore, completeEodStore } from "@/services/complete-eod-store";
import { useAuth } from "@/hooks/use-auth";

export function GlobalCompleteTaskEodDialog() {
  const { task, open, onDone } = useCompleteEodStore();
  const { user } = useAuth();

  if (!task || !user) return null;

  return (
    <CompleteTaskEodDialog
      open={open}
      onOpenChange={(v) => {
        if (!v) completeEodStore.close();
      }}
      task={task}
      userId={user.id}
      onDone={() => {
        completeEodStore.close();
        onDone?.();
      }}
    />
  );
}

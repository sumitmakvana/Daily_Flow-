import { useState, useEffect, useRef } from "react";
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
import { CheckCircle2, Clock, Loader2, Image as ImageIcon, Paperclip, X, FileText } from "lucide-react";
import { TaskHoursBadges } from "./TaskHoursBadges";
import type { Task } from "@/lib/types";
import { tasksService } from "@/services/tasks";
import { taskEodService } from "@/services/task-eod";
import { attachmentsService } from "@/services/attachments";
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
  const baseSys = Number((task as any).system_hours ?? 0);
  const runningSys = (task as any).started_at 
    ? Math.min(8.0, Math.max(0, Math.round(((Date.now() - new Date((task as any).started_at).getTime()) / 3600000) * 10) / 10))
    : 0;
  const sysHrs = baseSys + runningSys;

  const planned = Number(task.planned_hours ?? 0);
  const currentActual = Number(task.actual_hours ?? 0);
  const remaining = Math.max(0, planned - currentActual);
  const defaultFill = sysHrs > 0 ? sysHrs : (remaining > 0 ? remaining : (planned > 0 ? planned : 1));

  const [hours, setHours] = useState<string>(String(defaultFill));
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<Array<{ id: string; file: File; previewUrl: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setHours(String(defaultFill));
      setNote("");
      setBusy(false);
    } else {
      pendingFiles.forEach((x) => URL.revokeObjectURL(x.previewUrl));
      setPendingFiles([]);
    }
  }, [open, defaultFill]);

  const addPendingFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const newItems: Array<{ id: string; file: File; previewUrl: string }> = [];
    Array.from(files).forEach((f) => {
      if (f.size > 20 * 1024 * 1024) {
        toast.error(`Skipped ${f.name}: Exceeds 20MB limit`);
        return;
      }
      newItems.push({
        id: crypto.randomUUID(),
        file: f,
        previewUrl: URL.createObjectURL(f),
      });
    });
    if (newItems.length > 0) {
      setPendingFiles((prev) => [...prev, ...newItems]);
      toast.success(`Attached ${newItems.length} image(s)/proof file(s)`);
    }
  };

  const removePendingFile = (id: string) => {
    setPendingFiles((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          const namedFile = new File([file], `completion_screenshot_${Date.now()}.png`, { type: file.type });
          imageFiles.push(namedFile);
        }
      }
    }
    if (imageFiles.length > 0) {
      addPendingFiles(imageFiles);
    }
  };

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

      // 3. Upload attached proof images/files
      if (pendingFiles.length > 0) {
        for (const item of pendingFiles) {
          try {
            await attachmentsService.upload(task.id, item.file, userId);
          } catch (err) {
            console.error("Failed uploading completion attachment:", err);
          }
        }
        pendingFiles.forEach((x) => URL.revokeObjectURL(x.previewUrl));
        setPendingFiles([]);
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
          <div className="bg-card border border-border/80 rounded-xl p-3 space-y-2 shadow-xs">
            <div className="flex items-center justify-between text-xs flex-wrap gap-2">
              <span className="font-mono text-primary font-bold">{task.task_code}</span>
              <TaskHoursBadges task={task} variant="badges" />
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

          {/* Remarks / Note with Image & Screenshot Attachments */}
          <div className="space-y-1.5 border border-border bg-card p-3 rounded-xl">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground">Remarks / Note (Optional):</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="h-6 text-[10px] gap-1 px-2 border-border text-primary hover:bg-primary/10 transition-colors font-medium rounded-lg"
              >
                <ImageIcon className="h-3 w-3 text-primary" />
                <span>Attach Screenshot</span>
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf,.doc,.docx"
                className="hidden"
                onChange={(e) => {
                  addPendingFiles(e.target.files);
                  if (e.target) e.target.value = "";
                }}
              />
            </div>
            <Textarea
              placeholder="Any remarks for team or manager... (Tip: Press Ctrl+V to paste screenshot!)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onPaste={handlePaste}
              disabled={busy}
              rows={2}
              className="text-xs bg-background border-border text-foreground focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary focus:outline-none"
            />

            {/* Pending Attachment Previews */}
            {pendingFiles.length > 0 && (
              <div className="pt-1 space-y-1 border-t border-border/60">
                <div className="text-[10px] font-semibold text-muted-foreground flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Paperclip className="h-3 w-3 text-primary" /> Attachments ({pendingFiles.length})
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {pendingFiles.map((item) => {
                    const isImage = item.file.type.startsWith("image/");
                    return (
                      <div
                        key={item.id}
                        className="relative group bg-secondary/50 border border-border rounded-md p-1 flex items-center gap-1.5 overflow-hidden"
                      >
                        {isImage ? (
                          <img
                            src={item.previewUrl}
                            alt={item.file.name}
                            className="h-8 w-8 object-cover rounded shrink-0 border border-border bg-background"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded bg-secondary flex items-center justify-center shrink-0 border border-border">
                            <FileText className="h-4 w-4 text-primary" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-medium text-foreground truncate" title={item.file.name}>
                            {item.file.name}
                          </p>
                          <p className="text-[9px] text-muted-foreground font-mono">
                            {(item.file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePendingFile(item.id)}
                          className="p-0.5 rounded-full bg-destructive/90 text-white hover:bg-destructive transition-colors shrink-0"
                          title="Remove attachment"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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

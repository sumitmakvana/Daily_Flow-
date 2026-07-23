import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  AlertOctagon,
  Clock,
  Sun,
  ShieldCheck,
} from "lucide-react";
import { taskEodService, type EodTaskRow, type EodProgressStatus } from "@/services/task-eod";
import { todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/eod-tasks")({
  component: EodTasksPage,
});

interface DraftState {
  progress_status: EodProgressStatus;
  actual_hours: string;
  note: string;
  busy: boolean;
}

function defaultDraft(row: EodTaskRow): DraftState {
  const s = row.submission;
  return {
    progress_status: (s?.progress_status as EodProgressStatus) ?? deriveStatus(row.status),
    actual_hours: s ? String(Number(s.actual_hours)) : "",
    note: s?.note ?? "",
    busy: false,
  };
}

function deriveStatus(s: string): EodProgressStatus {
  if (s === "Completed") return "done";
  if (s === "Blocked") return "blocked";
  return "in_progress";
}

const PROGRESS_OPTIONS: { value: EodProgressStatus; label: string; icon: typeof CheckCircle2 }[] = [
  { value: "done", label: "Done", icon: CheckCircle2 },
  { value: "in_progress", label: "In progress", icon: Loader2 },
  { value: "blocked", label: "Blocked", icon: AlertOctagon },
];

function EodTasksPage() {
  const [rows, setRows] = useState<EodTaskRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const list = await taskEodService.myTasksToday();
      setRows(list);
      setDrafts((prev) => {
        const next: Record<string, DraftState> = {};
        for (const r of list) {
          next[r.task_id] = prev[r.task_id] && !prev[r.task_id].busy ? prev[r.task_id] : defaultDraft(r);
        }
        return next;
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const submittedCount = useMemo(() => rows.filter((r) => r.submission).length, [rows]);

  const updateDraft = (taskId: string, patch: Partial<DraftState>) => {
    setDrafts((prev) => ({ ...prev, [taskId]: { ...prev[taskId], ...patch } }));
  };

  const submit = async (row: EodTaskRow) => {
    const d = drafts[row.task_id];
    if (!d) return;
    const hours = Number(d.actual_hours || "0");
    if (Number.isNaN(hours) || hours < 0 || hours > 24) {
      toast.error("Hours must be between 0 and 24");
      return;
    }
    updateDraft(row.task_id, { busy: true });
    try {
      await taskEodService.submit(row.task_id, d.progress_status, hours, d.note.trim() || null);
      toast.success(`EOD saved · ${row.task_code}`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
      updateDraft(row.task_id, { busy: false });
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Sun className="h-5 w-5 text-priority-medium" /> Per-task end of day
          </h1>
          <p className="text-xs text-muted-foreground">
            {todayISO()} · {submittedCount}/{rows.length} submitted
          </p>
        </div>
      </div>

      {/* Guide Card to explain what to do */}
      <Card className="p-3 bg-muted/40 border border-border space-y-1.5">
        <h2 className="text-xs font-semibold flex items-center gap-1.5 text-foreground/80">
          💡 EOD Reporting Guide
        </h2>
        <p className="text-[11px] text-muted-foreground leading-normal">
          For each task, select your updated status, enter the hours spent today, and click <strong>Submit EOD</strong> or <strong>Save Changes</strong>. Your changes will sync automatically to the tasks board.
        </p>
      </Card>

      {loading && rows.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card>
      )}

      {!loading && rows.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No active tasks assigned to you today — nothing to submit.
        </Card>
      )}

      <div className="space-y-3">
        {rows.map((row) => {
          const d = drafts[row.task_id];
          if (!d) return null;
          const submission = row.submission;
          const acknowledged = !!submission?.acknowledged_at;

          const draftHours = Number(d.actual_hours || "0");
          const subHours = submission ? Number(submission.actual_hours || "0") : 0;
          const draftNote = (d.note || "").trim();
          const subNote = submission ? (submission.note || "").trim() : "";

          const hasChanges = !submission || 
            d.progress_status !== submission.progress_status ||
            draftHours !== subHours ||
            draftNote !== subNote;

          return (
            <Card key={row.task_id} className="p-3 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">{row.task_code}</div>
                  <div className="font-medium text-sm leading-snug">{row.task_name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                    <span>Status: {row.status}</span>
                    {row.priority && <span>Priority: {row.priority}</span>}
                    {row.due_date && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Due {row.due_date}
                      </span>
                    )}
                  </div>
                </div>
                {submission && (
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="secondary" className="text-[10px]">Submitted</Badge>
                    {acknowledged && (
                      <span className="text-[10px] text-status-completed inline-flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> Acknowledged
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                <div className="flex gap-1.5 flex-wrap">
                  {PROGRESS_OPTIONS.map((opt) => {
                    const active = d.progress_status === opt.value;
                    const Icon = opt.icon;
                    return (
                      <Button
                        key={opt.value}
                        size="sm"
                        variant={active ? "default" : "outline"}
                        type="button"
                        onClick={() => updateDraft(row.task_id, { progress_status: opt.value })}
                        disabled={d.busy}
                        className="h-8"
                      >
                        <Icon className="h-3.5 w-3.5 mr-1" /> {opt.label}
                      </Button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground" htmlFor={`hrs-${row.task_id}`}>
                    Hours
                  </label>
                  <Input
                    id={`hrs-${row.task_id}`}
                    type="number"
                    inputMode="decimal"
                    step="0.25"
                    min="0"
                    max="24"
                    className="h-8 w-20"
                    value={d.actual_hours}
                    onChange={(e) => updateDraft(row.task_id, { actual_hours: e.target.value })}
                    disabled={d.busy}
                  />
                </div>
              </div>

              <Textarea
                placeholder="Note for your manager (optional)…"
                value={d.note}
                onChange={(e) => updateDraft(row.task_id, { note: e.target.value })}
                disabled={d.busy}
                rows={2}
                className="text-sm"
              />

              <div className="flex justify-end items-center gap-2.5">
                {!hasChanges && submission && (
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    ✓ Saved for today
                  </span>
                )}
                <Button 
                  size="sm" 
                  onClick={() => submit(row)} 
                  disabled={d.busy || (!hasChanges && !!submission)}
                  variant={hasChanges ? "default" : "outline"}
                >
                  {d.busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                  {submission ? (hasChanges ? "Save Changes" : "Saved") : "Submit EOD"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

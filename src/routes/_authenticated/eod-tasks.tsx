import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
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
  useRealtimeTasks(reload, "eod-tasks-rt");

  const submittedCount = useMemo(() => rows.filter((r) => r.submission).length, [rows]);

  const totalPlanned = useMemo(() => rows.reduce((s, r) => s + Number(r.planned_hours ?? 0), 0), [rows]);
  const totalLoggedToday = useMemo(() => {
    return Object.values(drafts).reduce((s, d) => s + Number(d.actual_hours || "0"), 0);
  }, [drafts]);

  const updateDraft = (taskId: string, patch: Partial<DraftState>) => {
    setDrafts((prev) => ({ ...prev, [taskId]: { ...prev[taskId], ...patch } }));
  };

  const handleStatusChange = (row: EodTaskRow, newStatus: EodProgressStatus) => {
    const currentDraft = drafts[row.task_id];
    const planned = Number(row.planned_hours ?? 0);
    let newHours = currentDraft?.actual_hours || "";

    // Auto-fill planned hours if marking done and hours field is empty or 0
    if (newStatus === "done" && (!newHours || Number(newHours) === 0) && planned > 0) {
      newHours = String(planned);
      toast.info(`✨ Auto-filled ${planned}h from Planned Hours for ${row.task_code}. Click Save to confirm.`);
    }

    updateDraft(row.task_id, {
      progress_status: newStatus,
      actual_hours: newHours,
    });
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
            <Sun className="h-5 w-5 text-amber-400" /> Per-task end of day
          </h1>
          <p className="text-xs text-muted-foreground">
            {todayISO()} · {submittedCount}/{rows.length} submitted
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/30 font-bold px-2.5 py-1">
            🎯 Planned Today: {totalPlanned}h
          </Badge>
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-bold px-2.5 py-1">
            ⏱️ Logged Today: {totalLoggedToday}h
          </Badge>
        </div>
      </div>

      {/* Guide Card to explain what to do */}
      <Card className="p-3 bg-muted/40 border border-border space-y-1.5">
        <h2 className="text-xs font-semibold flex items-center gap-1.5 text-foreground/80">
          💡 Quick EOD Reporting Guide
        </h2>
        <p className="text-[11px] text-muted-foreground leading-normal">
          For each task, click <strong>Done</strong>, <strong>In progress</strong>, or <strong>Blocked</strong>. Clicking <strong>Done</strong> auto-fills your planned hours! Use quick fill buttons to adjust hours easily and click <strong>Submit EOD</strong>.
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

          const plannedHrs = Number(row.planned_hours ?? 0);
          const totalActualHrs = Number(row.total_actual_hours ?? 0);

          const hasChanges = !submission || 
            d.progress_status !== submission.progress_status ||
            draftHours !== subHours ||
            draftNote !== subNote;

          return (
            <Card key={row.task_id} className="p-3.5 space-y-3 border-border hover:border-indigo-500/30 transition-all">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0 space-y-1">
                  <div className="text-xs font-mono font-bold text-indigo-400">{row.task_code}</div>
                  <div className="font-semibold text-sm leading-snug">{row.task_name}</div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span>Status: <strong className="text-foreground">{row.status}</strong></span>
                    {row.priority && <span>Priority: <strong className="text-foreground">{row.priority}</strong></span>}
                    {row.due_date && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Due {row.due_date}
                      </span>
                    )}
                    <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/30 text-[10px] font-bold">
                      🎯 Planned: {plannedHrs}h
                    </Badge>
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] font-bold">
                      ⏱️ Logged: {totalActualHrs}h
                    </Badge>
                  </div>
                </div>
                {submission && (
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="secondary" className="text-[10px] bg-indigo-500/20 text-indigo-300 border-indigo-500/40">Submitted</Badge>
                    {acknowledged && (
                      <span className="text-[10px] text-emerald-400 inline-flex items-center gap-1 font-semibold">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Acknowledged
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Status Selector & Hours Input with Quick Fill Presets */}
              <div className="bg-muted/20 border border-border/60 rounded-xl p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
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
                          onClick={() => handleStatusChange(row, opt.value)}
                          disabled={d.busy}
                          className={`h-8 font-medium ${active ? "bg-indigo-600 hover:bg-indigo-500 text-white font-bold" : ""}`}
                        >
                          <Icon className="h-3.5 w-3.5 mr-1" /> {opt.label}
                        </Button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-foreground" htmlFor={`hrs-${row.task_id}`}>
                      Today's Hours:
                    </label>
                    <Input
                      id={`hrs-${row.task_id}`}
                      type="number"
                      inputMode="decimal"
                      step="0.25"
                      min="0"
                      max="24"
                      className="h-8 w-24 font-bold text-right text-indigo-400 bg-background border-indigo-500/40 focus:border-indigo-500"
                      value={d.actual_hours}
                      onChange={(e) => updateDraft(row.task_id, { actual_hours: e.target.value })}
                      disabled={d.busy}
                    />
                  </div>
                </div>

                {/* Quick Presets Row for Easy 1-Click Hour Fill */}
                <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1 border-t border-border/40 text-xs">
                  <span className="text-[11px] text-muted-foreground mr-1">Quick fill:</span>
                  {[0.5, 1, 2, plannedHrs].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i).map((hrs) => (
                    <Button
                      key={hrs}
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={d.busy}
                      onClick={() => updateDraft(row.task_id, { actual_hours: String(hrs) })}
                      className="h-6 px-2 text-[10px] bg-muted/60 hover:bg-indigo-600 hover:text-white transition-colors"
                    >
                      {hrs === plannedHrs ? `Planned (${hrs}h)` : `+${hrs}h`}
                    </Button>
                  ))}
                </div>
              </div>

              <Textarea
                placeholder="Note for your manager (optional)…"
                value={d.note}
                onChange={(e) => updateDraft(row.task_id, { note: e.target.value })}
                disabled={d.busy}
                rows={2}
                className="text-sm bg-background border-border"
              />

              <div className="flex justify-end items-center gap-2.5 pt-1">
                {!hasChanges && submission && (
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    ✓ Saved for today
                  </span>
                )}
                <Button 
                  size="sm" 
                  onClick={() => submit(row)} 
                  disabled={d.busy || (!hasChanges && !!submission)}
                  className={hasChanges ? "bg-indigo-600 hover:bg-indigo-500 text-white font-bold" : ""}
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

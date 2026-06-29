import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CheckCircle2, Loader2, AlertOctagon, ShieldCheck, Sun } from "lucide-react";
import { taskEodService, type ManagerEodRow } from "@/services/task-eod";
import { todayISO } from "@/lib/format";

const STATUS_TONE: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  done: { label: "Done", className: "bg-status-completed/15 text-status-completed border-status-completed/30", icon: CheckCircle2 },
  in_progress: { label: "In progress", className: "bg-status-progress/15 text-status-progress border-status-progress/30", icon: Loader2 },
  blocked: { label: "Blocked", className: "bg-status-blocked/15 text-status-blocked border-status-blocked/30", icon: AlertOctagon },
};

export function TaskEodReviewCard() {
  const [rows, setRows] = useState<ManagerEodRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const list = await taskEodService.listForDate(todayISO());
      setRows(list);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const ack = async (id: string) => {
    setBusyId(id);
    try {
      await taskEodService.acknowledge(id);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const pending = rows.filter((r) => !r.acknowledged_at).length;

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Sun className="h-4 w-4 text-priority-medium" />
          Per-task EOD · today
        </h2>
        <span className="text-xs text-muted-foreground">
          {pending} pending · {rows.length} total
        </span>
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground italic">Loading…</p>
      )}

      {!loading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No submissions yet today.</p>
      )}

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r) => {
            const tone = STATUS_TONE[r.progress_status] ?? STATUS_TONE.in_progress;
            const Icon = tone.icon;
            return (
              <li
                key={r.id}
                className="border border-border/60 rounded-md p-2 text-sm space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-xs">{r.task_code}</span>
                      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${tone.className}`}>
                        <Icon className="h-3 w-3" /> {tone.label}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {Number(r.actual_hours)}h
                      </Badge>
                    </div>
                    <div className="text-xs truncate">{r.task_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.user_display_name ?? "Unknown"} · {new Date(r.submitted_at).toLocaleTimeString()}
                    </div>
                  </div>
                  {r.acknowledged_at ? (
                    <span className="text-[10px] text-status-completed inline-flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" /> Acknowledged
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => ack(r.id)}
                      disabled={busyId === r.id}
                    >
                      {busyId === r.id ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                      Acknowledge
                    </Button>
                  )}
                </div>
                {r.note && (
                  <p className="text-xs text-muted-foreground border-l-2 border-border pl-2">
                    {r.note}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, AlertOctagon, Clock } from "lucide-react";
import type { Task } from "@/lib/types";
import { isOverdue, isToday } from "@/lib/format";
import { eodService } from "@/services/eod";
import { carryForwardService } from "@/services/carry-forward";
import { toast } from "sonner";

export function EodCheckInSheet({
  open,
  onOpenChange,
  userId,
  tasks,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  tasks: Task[];
  onDone?: () => void;
}) {
  const counts = useMemo(() => {
    const mine = tasks;
    const completedToday = mine.filter((t) => t.status === "Completed" && t.completed_at && isToday(t.completed_at)).length;
    const blocked = mine.filter((t) => t.status === "Blocked");
    const pending = mine.filter((t) => t.status !== "Completed" && t.status !== "Blocked");
    const remaining = pending.reduce(
      (s, t) => s + Math.max(0, Number(t.planned_hours ?? 0) - Number(t.actual_hours ?? 0)),
      0,
    );
    return { completedToday, blocked, pending, remainingDefault: Math.round(remaining * 10) / 10 };
  }, [tasks]);

  const [remaining, setRemaining] = useState<number[]>([counts.remainingDefault || 0]);
  const [tomorrow, setTomorrow] = useState<string>("");
  const [note, setNote] = useState("");
  const [carry, setCarry] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setRemaining([counts.remainingDefault || 0]);
      setTomorrow("");
      setNote("");
      setCarry(true);
    }
  }, [open, counts.remainingDefault]);

  const tomorrowOptions = counts.pending
    .slice()
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === "High" ? -1 : 1))
    .slice(0, 10);

  const submit = async () => {
    setBusy(true);
    try {
      await eodService.upsert(userId, {
        pending_count: counts.pending.length,
        blocker_count: counts.blocked.length,
        completed_count: counts.completedToday,
        remaining_hours: remaining[0] ?? 0,
        tomorrow_priority_task_id: tomorrow || null,
        note: note.trim() || null,
      });
      let carried = 0;
      let failed = 0;
      if (carry) {
        const res = await carryForwardService.carryAllOverdue(userId, userId);
        carried = res.ok;
        failed = res.failed;
      }
      toast.success(
        carried > 0
          ? `Check-in saved · ${carried} task${carried === 1 ? "" : "s"} carried forward${failed ? ` · ${failed} failed` : ""}`
          : "Check-in saved",
      );
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-xl">
        <SheetHeader className="text-left">
          <SheetTitle>End-of-day check-in</SheetTitle>
          <SheetDescription>Two minutes. We pre-filled what we know.</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Stat icon={<CheckCircle2 className="h-4 w-4 text-status-completed" />} label="Done" value={counts.completedToday} />
            <Stat icon={<Clock className="h-4 w-4 text-status-progress" />} label="Pending" value={counts.pending.length} />
            <Stat icon={<AlertOctagon className="h-4 w-4 text-status-blocked" />} label="Blocked" value={counts.blocked.length} />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Remaining effort (hrs)</label>
            <Slider value={remaining} onValueChange={setRemaining} min={0} max={16} step={0.5} className="mt-2" />
            <div className="mt-1 text-right text-xs text-muted-foreground">{remaining[0]}h</div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Tomorrow's top task</label>
            <Select value={tomorrow} onValueChange={setTomorrow}>
              <SelectTrigger className="mt-1.5 h-10"><SelectValue placeholder="Pick one (optional)" /></SelectTrigger>
              <SelectContent>
                {tomorrowOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.task_code} · {t.task_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Anything to flag?</label>
            <Textarea
              className="mt-1.5"
              rows={2}
              placeholder="Blocker, risk, comment…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={carry}
              onChange={(e) => setCarry(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Carry {tasks.filter((t) => isOverdue(t.due_date, t.status)).length} overdue task(s) to next working day
          </label>

          <div className="flex gap-2 pt-2 sticky bottom-0 bg-background pb-2">
            <Button variant="ghost" className="flex-1 h-11" onClick={() => onOpenChange(false)}>
              Later
            </Button>
            <Button className="flex-1 h-11" onClick={submit} disabled={busy}>
              {busy ? "Saving…" : "Submit check-in"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-2 text-center">
      <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">{icon} {label}</div>
      <div className="mt-0.5 text-xl font-semibold">{value}</div>
    </div>
  );
}

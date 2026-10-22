import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leavesService } from "@/services/leaves";
import { useAuth } from "@/hooks/use-auth";
import { LEAVE_TYPES } from "@/components/LeaveDialog";
import { cn } from "@/lib/utils";
import { Palmtree, RefreshCw } from "lucide-react";
import type { Leave } from "@/lib/types";

interface MyLeaveReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Pastel strip + icon bubble colours per leave type (tinted so they work in light and dark themes)
const CARD_TONE: Record<string, { strip: string; bubble: string; icon: string }> = {
  planned: { strip: "bg-blue-500/15", bubble: "bg-blue-500/15", icon: "text-blue-400" },
  tentative: { strip: "bg-orange-500/15", bubble: "bg-orange-500/15", icon: "text-orange-400" },
  sick: { strip: "bg-purple-500/15", bubble: "bg-purple-500/15", icon: "text-purple-400" },
  wfh: { strip: "bg-sky-500/15", bubble: "bg-sky-500/15", icon: "text-sky-400" },
  half_day: { strip: "bg-emerald-500/15", bubble: "bg-emerald-500/15", icon: "text-emerald-400" },
};

const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** My Leave Report: this year's leave days by type and status, from the existing leaves API. */
export function MyLeaveReportDialog({ open, onOpenChange }: MyLeaveReportDialogProps) {
  const { user } = useAuth();
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(false);
  const year = new Date().getFullYear();
  const [month, setMonth] = useState<string>("all"); // "all" or "01".."12"

  useEffect(() => {
    if (!open || !user?.id) return;
    setMonth("all");
    let cancelled = false;
    setLoading(true);
    leavesService
      .getLeaves({ userId: user.id, startDate: `${year}-01-01`, endDate: `${year}-12-31` })
      .then((rows) => !cancelled && setLeaves(rows))
      .catch(() => !cancelled && setLeaves([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, user?.id, year]);

  const stats = useMemo(() => {
    // A leave belongs to the month it starts in, so multi-month leaves are never counted twice
    const inScope = month === "all" ? leaves : leaves.filter((l) => l.start_date.slice(5, 7) === month);
    const sum = (type: string, status: string) =>
      inScope
        .filter((l) => (l.leave_type === "casual" ? "planned" : l.leave_type) === type && l.status === status)
        .reduce((acc, l) => acc + Number(l.days_count ?? 1), 0);
    return LEAVE_TYPES.map((t) => ({
      ...t,
      booked: sum(t.id, "approved"),
      pending: sum(t.id, "pending"),
      tentative: sum(t.id, "tentative"),
    }));
  }, [leaves, month]);

  const totalLeaveBooked = stats.filter((s) => s.id !== "wfh").reduce((a, s) => a + s.booked, 0);
  const totalWfh = stats.find((s) => s.id === "wfh")?.booked ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto bg-card border-border shadow-xl p-4 sm:p-5">
        <DialogHeader className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Palmtree className="h-3.5 w-3.5" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-foreground">My Leave Report</DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground">
                Your leave days for {month === "all" ? year : `${MONTH_NAMES[Number(month) - 1]} ${year}`}, in working days.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center text-xs text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
            Loading your leave report...
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="h-8 text-xs bg-background border-border" aria-label="Filter by month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border max-h-60">
                <SelectItem value="all" className="text-xs">
                  Full year {year}
                </SelectItem>
                {MONTH_NAMES.map((name, i) => (
                  <SelectItem key={name} value={String(i + 1).padStart(2, "0")} className="text-xs">
                    {name} {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <div className="text-[10px] font-medium text-muted-foreground">Leave days booked</div>
                <div className="text-xl font-bold text-foreground">{fmtDays(totalLeaveBooked)}</div>
              </div>
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <div className="text-[10px] font-medium text-muted-foreground">WFH days</div>
                <div className="text-xl font-bold text-foreground">{fmtDays(totalWfh)}</div>
              </div>
            </div>

            <div className="space-y-2">
              {stats.map((s) => {
                const Icon = s.icon;
                const isTentative = s.id === "tentative";
                const tone = CARD_TONE[s.id] ?? CARD_TONE.planned;
                return (
                  <div key={s.id} className="relative flex items-stretch rounded-xl border border-border bg-card shadow-xs">
                    <span className={cn("w-4 shrink-0 rounded-l-xl", tone.strip)} />
                    <span
                      className={cn(
                        "absolute left-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full",
                        tone.bubble
                      )}
                    >
                      <Icon className={cn("h-4 w-4", tone.icon)} />
                    </span>
                    <div className="flex-1 space-y-1.5 py-3 pl-8 pr-3">
                      <div className="text-xs font-semibold text-foreground">{s.label}</div>
                      {isTentative ? (
                        <Row label="Tentative (not approved)" value={s.tentative} />
                      ) : (
                        <>
                          <Row label="Booked" value={s.booked} strong />
                          {s.pending > 0 && <Row label="Pending approval" value={s.pending} />}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button type="button" variant="outline" size="sm" className="h-7.5 text-xs" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", strong ? "font-bold text-foreground" : "font-medium text-foreground/80")}>
        {fmtDays(value)}
      </span>
    </div>
  );
}

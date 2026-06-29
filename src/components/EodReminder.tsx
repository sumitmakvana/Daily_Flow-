import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sun, CheckCircle2 } from "lucide-react";
import type { Task } from "@/lib/types";
import { EodCheckInSheet } from "./EodCheckInSheet";
import { eodService } from "@/services/eod";
import { notifPrefsService } from "@/services/notif-prefs";

export function EodReminder({ tasks, userId, onDone }: { tasks: Task[]; userId: string; onDone?: () => void }) {
  const [hour, setHour] = useState(16);
  const [hasCheckin, setHasCheckin] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [prefs, today] = await Promise.all([
        notifPrefsService.get(userId),
        eodService.getToday(userId),
      ]);
      if (!mounted) return;
      setHour(prefs.eod_reminder_hour ?? 16);
      setHasCheckin(!!today);
    })();
    return () => {
      mounted = false;
    };
  }, [userId]);

  const show = new Date().getHours() >= hour;
  if (!show) return null;

  if (hasCheckin) {
    return (
      <Card className="p-3 border-status-completed/30 bg-status-completed/5">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-status-completed" />
          <span className="font-medium">EOD check-in submitted</span>
          <Button size="sm" variant="ghost" className="ml-auto h-8" onClick={() => setOpen(true)}>
            Edit
          </Button>
        </div>
        <EodCheckInSheet
          open={open}
          onOpenChange={setOpen}
          userId={userId}
          tasks={tasks}
          onDone={() => {
            setHasCheckin(true);
            onDone?.();
          }}
        />
      </Card>
    );
  }

  return (
    <>
      <Card className="p-3 border-primary/30 bg-primary/5">
        <div className="flex items-start gap-2">
          <Sun className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">Wrap up the day</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Two-minute check-in. Auto-carries overdue work to tomorrow.
            </p>
          </div>
          <Button size="sm" className="h-9" onClick={() => setOpen(true)}>
            Start
          </Button>
        </div>
      </Card>
      <EodCheckInSheet
        open={open}
        onOpenChange={setOpen}
        userId={userId}
        tasks={tasks}
        onDone={() => {
          setHasCheckin(true);
          onDone?.();
        }}
      />
    </>
  );
}

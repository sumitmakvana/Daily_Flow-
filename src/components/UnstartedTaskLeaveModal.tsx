import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, CheckCircle2 } from "lucide-react";
import { leavesService } from "@/services/leaves";
import { toast } from "sonner";

export function UnstartedTaskLeaveModal() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [userName, setUserName] = useState("Team Member");

  useEffect(() => {
    // Check if dismissed in this session
    const todayStr = new Date().toISOString().slice(0, 10);
    const dismissedKey = `leave_prompt_dismissed_${todayStr}`;
    if (sessionStorage.getItem(dismissedKey)) {
      return;
    }

    // Run 12 PM check
    leavesService
      .checkUnstartedTasksToday()
      .then((res) => {
        if (res?.needsLeavePrompt) {
          if (res.userName) setUserName(res.userName);
          setOpen(true);
        }
      })
      .catch((err) => {
        console.warn("[UnstartedTaskLeaveModal] check error:", err);
      });
  }, []);

  const handleDismiss = () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    sessionStorage.setItem(`leave_prompt_dismissed_${todayStr}`, "true");
    setOpen(false);
  };

  const handleConfirmLeave = async () => {
    setLoading(true);
    try {
      await leavesService.quickMarkLeaveToday("Auto-marked leave via 12 PM unstarted task prompt");
      toast.success("Leave marked for today! Leave Planner updated.");
      queryClient.invalidateQueries({ queryKey: ["leaves"] });
      queryClient.invalidateQueries({ queryKey: ["capacity-profiles"] });
      handleDismiss();
    } catch (err: any) {
      toast.error(err?.message || "Failed to mark leave");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleDismiss()}>
      <DialogContent className="sm:max-w-md border-border/80 bg-card text-card-foreground shadow-2xl p-6 rounded-2xl">
        <DialogHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
              <Clock className="h-6 w-6" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                12:00 PM Work Status Check
              </DialogTitle>
              <p className="text-xs text-muted-foreground">Automated Leave & Work Verification</p>
            </div>
          </div>

          <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
            Hello <span className="font-semibold text-foreground">{userName}</span>, we noticed you haven't started any assigned tasks or logged hours today by <span className="font-semibold text-amber-400">12:00 PM</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted/40 border border-border/70 rounded-xl p-3.5 space-y-2 text-xs">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <Calendar className="h-4 w-4 text-primary shrink-0" />
            <span>Are you taking leave today?</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Confirming will automatically register a 1-day leave in the <strong className="text-foreground">Leave Planner</strong> and notify your project lead.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-col-reverse sm:flex-row pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleDismiss}
            disabled={loading}
            className="w-full sm:w-auto h-9 text-xs font-medium border-border"
          >
            No, Working Today
          </Button>
          <Button
            type="button"
            onClick={handleConfirmLeave}
            disabled={loading}
            className="w-full sm:w-auto h-9 text-xs font-semibold gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
          >
            <CheckCircle2 className="h-4 w-4" />
            Yes, Mark Leave Today
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

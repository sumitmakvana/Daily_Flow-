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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { leavesService } from "@/services/leaves";
import { useAuth } from "@/hooks/use-auth";
import { toLocalISO } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, Palmtree, Home, Activity, Clock, UserCheck } from "lucide-react";
import type { Profile, Leave } from "@/lib/types";
import { cn } from "@/lib/utils";

interface LeaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: Date | null;
  leaveToEdit?: Leave | null;
  onSuccess?: () => void;
}

const LEAVE_TYPES = [
  { id: "casual", label: "Casual Leave", icon: Palmtree, badge: "CL" },
  { id: "sick", label: "Sick Leave", icon: Activity, badge: "SL" },
  { id: "wfh", label: "Work From Home (WFH)", icon: Home, badge: "WFH" },
  { id: "half_day", label: "Half Day", icon: Clock, badge: "0.5D" },
  // { id: "paid", label: "Paid Leave", icon: Calendar, badge: "PL" },
];


export function LeaveDialog({
  open,
  onOpenChange,
  initialDate,
  leaveToEdit,
  onSuccess,
}: LeaveDialogProps) {
  const { user } = useAuth();
  const [leaveType, setLeaveType] = useState<string>("casual");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [handoverNote, setHandoverNote] = useState<string>("");
  const [requestTo, setRequestTo] = useState<string>("default");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (leaveToEdit) {
        setStartDate(leaveToEdit.start_date);
        setEndDate(leaveToEdit.end_date);
        setReason(leaveToEdit.reason || "");
        setHandoverNote(leaveToEdit.handover_note || "");
        setLeaveType(leaveToEdit.leave_type || "casual");
        setRequestTo(leaveToEdit.request_to || "default");
      } else {
        const defaultDate = initialDate ? toLocalISO(initialDate) : toLocalISO(new Date());
        setStartDate(defaultDate);
        setEndDate(defaultDate);
        setReason("");
        setHandoverNote("");
        setLeaveType("casual");
        setRequestTo("default");
      }

      // Load active profiles for Request To dropdown
      supabase
        .from("profiles")
        .select("id, display_name, email, avatar_url, manager_id")
        .eq("is_active", true)
        .order("display_name")
        .then(({ data }) => {
          if (data) setProfiles(data as Profile[]);
        });
    }
  }, [open, initialDate, leaveToEdit]);

  // Calculate day count
  const calculateDays = () => {
    if (!startDate || !endDate) return 1;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) return 0;
    if (leaveType === "half_day") return 0.5;
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
  };

  const daysCount = calculateDays();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      toast.error("Please select start and end dates");
      return;
    }
    if (new Date(endDate) < new Date(startDate)) {
      toast.error("End date cannot be earlier than start date");
      return;
    }

    setSubmitting(true);
    try {
      if (leaveToEdit) {
        await leavesService.updateLeave(leaveToEdit.id, {
          leaveType,
          startDate,
          endDate,
          daysCount,
          reason: reason.trim() || undefined,
          requestTo: requestTo === "default" ? null : requestTo,
          handoverNote: handoverNote.trim() || undefined,
        });
        toast.success("Leave request updated successfully!");
      } else {
        await leavesService.applyLeave({
          userId: user?.id,
          leaveType,
          startDate,
          endDate,
          daysCount,
          reason: reason.trim() || undefined,
          requestTo: requestTo === "default" ? null : requestTo,
          handoverNote: handoverNote.trim() || undefined,
          status: "approved",
        });

        toast.success(
          leaveType === "wfh"
            ? `WFH scheduled for ${startDate === endDate ? startDate : `${startDate} to ${endDate}`}`
            : `Leave request submitted (${daysCount} ${daysCount === 1 ? "day" : "days"})`
        );
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error((err as Error).message || "Failed to submit leave request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground text-base font-semibold">
            <Palmtree className="h-5 w-5 text-primary" />
            {leaveToEdit ? "Edit Leave / WFH Request" : "Request Leave / WFH"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {leaveToEdit ? "Update your dates, leave type, or notification recipient." : "Apply for leave or work from home. Select who receives the alert and notification."}
          </DialogDescription>
        </DialogHeader>


        <form onSubmit={handleSubmit} className="space-y-3.5 py-1.5">
          {/* Leave Type Selector */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">Type</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {LEAVE_TYPES.map((t) => {
                const Icon = t.icon;
                const isSelected = leaveType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setLeaveType(t.id);
                      if (t.id === "half_day") {
                        setEndDate(startDate);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1.5 p-2 rounded-lg border text-left text-xs transition-all cursor-pointer select-none",
                      isSelected
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border bg-background hover:bg-muted/50 text-muted-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t.label.split(" (")[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date Range Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="start_date" className="text-xs font-medium text-foreground">
                From Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="start_date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (leaveType === "half_day" || !endDate || new Date(endDate) < new Date(e.target.value)) {
                    setEndDate(e.target.value);
                  }
                }}
                required
                className="h-9 text-xs bg-background border-border"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="end_date" className="text-xs font-medium text-foreground">
                To Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="end_date"
                type="date"
                value={endDate}
                disabled={leaveType === "half_day"}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="h-9 text-xs bg-background border-border"
              />
            </div>
          </div>

          {/* Duration Summary */}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground bg-muted/30 px-3 py-1.5 rounded-md border border-border">
            <span>Duration:</span>
            <span className="font-semibold text-foreground">
              {daysCount} {daysCount === 1 ? "Day" : "Days"}
              {leaveType === "wfh" && " (Remote Work)"}
            </span>
          </div>

          {/* Request To / Send Notification Dropdown */}
          <div className="space-y-1.5">
            <Label htmlFor="request_to" className="text-xs font-medium text-foreground flex items-center gap-1">
              <UserCheck className="h-3.5 w-3.5 text-primary" /> Request To / Send Notification To
            </Label>
            <Select value={requestTo} onValueChange={setRequestTo}>
              <SelectTrigger id="request_to" className="h-9 text-xs bg-background border-border">
                <SelectValue placeholder="Select manager / recipient" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="default" className="text-xs">
                  Default (Assigned Manager / Admin)
                </SelectItem>
                {profiles
                  .filter((p) => p.id !== user?.id)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.display_name} {p.email ? `(${p.email})` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reason (Optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="reason" className="text-xs font-medium text-foreground">
              Reason for leave <span className="text-[10px] text-muted-foreground font-normal">(Optional)</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Personal work, doctor appointment, focus day (optional)..."
              rows={2}
              className="text-xs bg-background border-border resize-none"
            />
          </div>

          {/* Handover Note */}
          <div className="space-y-1.5">
            <Label htmlFor="handover" className="text-xs font-medium text-muted-foreground">
              Handover Note / Emergency Reach (Optional)
            </Label>
            <Input
              id="handover"
              value={handoverNote}
              onChange={(e) => setHandoverNote(e.target.value)}
              placeholder="Tasks handed over to..."
              className="h-8 text-xs bg-background border-border"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !startDate}
              className="text-xs"
            >
              {submitting ? "Saving..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


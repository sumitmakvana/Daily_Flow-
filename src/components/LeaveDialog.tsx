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
import { Calendar, Palmtree, Home, Activity, Clock, UserCheck, User, Sparkles, Check } from "lucide-react";
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
  { id: "casual", label: "Casual Leave", desc: "Planned personal time off", icon: Palmtree, dot: "bg-purple-400" },
  { id: "sick", label: "Sick Leave", desc: "Medical or health recovery", icon: Activity, dot: "bg-amber-400" },
  { id: "wfh", label: "Work From Home", desc: "Remote work day", icon: Home, dot: "bg-sky-400" },
  { id: "half_day", label: "Half Day", desc: "0.5 day session (morning/afternoon)", icon: Clock, dot: "bg-emerald-400" },
];

export function LeaveDialog({
  open,
  onOpenChange,
  initialDate,
  leaveToEdit,
  onSuccess,
}: LeaveDialogProps) {
  const { user, isManager } = useAuth();
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
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
        setSelectedMemberId(leaveToEdit.user_id);
        setStartDate(leaveToEdit.start_date);
        setEndDate(leaveToEdit.end_date);
        setReason(leaveToEdit.reason || "");
        setHandoverNote(leaveToEdit.handover_note || "");
        setLeaveType(leaveToEdit.leave_type || "casual");
        setRequestTo(leaveToEdit.request_to || "default");
      } else {
        setSelectedMemberId(user?.id || "");
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
      const targetUserId = isManager && selectedMemberId ? selectedMemberId : (user?.id || "");

      if (leaveToEdit) {
        await leavesService.updateLeave(leaveToEdit.id, {
          userId: targetUserId,
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
          userId: targetUserId,
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

  const selectedProfile = profiles.find((p) => p.id === (selectedMemberId || user?.id));
  const memberInitials = (selectedProfile?.display_name || "TM")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto bg-card border-border shadow-xl p-4 sm:p-5" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader className="space-y-0.5 pb-1">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Palmtree className="h-3.5 w-3.5" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-foreground">
                {leaveToEdit ? "Edit Leave / WFH Request" : "Request Leave / WFH"}
              </DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground">
                {leaveToEdit ? "Modify dates, leave type, or notification recipient." : "Apply for leave or WFH and notify managers."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 pt-1">
          {/* Employee Selector for Managers/Admins */}
          {isManager && (
            <div className="space-y-1 p-2 rounded-lg border border-border/80 bg-muted/20">
              <div className="flex items-center justify-between text-[11px]">
                <Label htmlFor="employee_select" className="text-[11px] font-semibold text-foreground flex items-center gap-1">
                  <User className="h-3 w-3 text-primary" /> Applying For (Team Member)
                </Label>
                <span className="text-[9px] text-muted-foreground">Admin/Manager</span>
              </div>
              <Select value={selectedMemberId || user?.id} onValueChange={setSelectedMemberId}>
                <SelectTrigger id="employee_select" className="h-8 text-xs bg-background border-border">
                  <div className="flex items-center gap-1.5 truncate">
                    <div className="h-4 w-4 rounded-full bg-primary/15 text-[9px] font-bold text-primary flex items-center justify-center shrink-0">
                      {memberInitials}
                    </div>
                    <span className="truncate">{selectedProfile?.display_name || "Select team member"}</span>
                    {selectedProfile?.id === user?.id && (
                      <span className="text-[10px] text-muted-foreground">(You)</span>
                    )}
                  </div>
                </SelectTrigger>
                <SelectContent className="bg-popover border-border max-h-48">
                  {profiles.map((p) => {
                    const initials = p.display_name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase();
                    return (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-4 rounded-full bg-primary/10 text-[9px] font-bold text-primary flex items-center justify-center shrink-0">
                            {initials}
                          </div>
                          <span>{p.display_name}</span>
                          {p.id === user?.id && <span className="text-[10px] text-muted-foreground">(You)</span>}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Leave Type Selector: Compact 2x2 Grid */}
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold text-foreground">Type</Label>
            <div className="grid grid-cols-2 gap-1.5">
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
                      "flex items-center gap-2 p-2 rounded-lg border text-left text-xs transition-all cursor-pointer select-none",
                      isSelected
                        ? "border-primary bg-primary/10 text-foreground font-semibold shadow-xs ring-1 ring-primary/40"
                        : "border-border/80 bg-muted/20 hover:bg-muted/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                    <span className="truncate flex-1 font-medium">{t.label}</span>
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", t.dot)} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date Range Inputs */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label htmlFor="start_date" className="text-[11px] font-semibold text-foreground">
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
                className="h-8 text-xs bg-background border-border"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="end_date" className="text-[11px] font-semibold text-foreground">
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
                className="h-8 text-xs bg-background border-border disabled:opacity-60"
              />
            </div>
          </div>

          {/* Duration Summary Pill */}
          <div className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg bg-muted/30 border border-border">
            <span className="text-muted-foreground text-[10px] font-medium flex items-center gap-1">
              <Calendar className="h-3 w-3 text-primary" /> Total Duration:
            </span>
            <span className="font-bold text-foreground text-[11px] bg-card px-2 py-0.2 rounded border border-border shadow-xs">
              {daysCount} {daysCount === 1 ? "Day" : "Days"}
              {leaveType === "half_day" ? " (0.5D Half Day)" : leaveType === "wfh" ? " (Remote WFH)" : " (Full Day)"}
            </span>
          </div>

          {/* Request To / Send Notification Dropdown */}
          <div className="space-y-1">
            <Label htmlFor="request_to" className="text-[11px] font-semibold text-foreground flex items-center gap-1">
              <UserCheck className="h-3 w-3 text-primary" /> Request To / Notify Manager
            </Label>
            <Select value={requestTo} onValueChange={setRequestTo}>
              <SelectTrigger id="request_to" className="h-8 text-xs bg-background border-border">
                <SelectValue placeholder="Select manager / recipient" />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border max-h-48">
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
          <div className="space-y-1">
            <Label htmlFor="reason" className="text-[11px] font-semibold text-foreground">
              Reason for leave <span className="text-[9px] text-muted-foreground font-normal">(Optional)</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Personal work, doctor appointment, focus day..."
              rows={2}
              className="text-xs bg-background border-border resize-none py-1.5 min-h-[52px]"
            />
          </div>

          {/* Handover Note */}
          <div className="space-y-1">
            <Label htmlFor="handover" className="text-[10px] font-medium text-muted-foreground">
              Handover Note / Emergency Reach (Optional)
            </Label>
            <Input
              id="handover"
              value={handoverNote}
              onChange={(e) => setHandoverNote(e.target.value)}
              placeholder="e.g. Tasks handed over to Nirav..."
              className="h-7 text-xs bg-background border-border"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-1.5 border-t border-border/60">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="text-xs h-7.5 px-3"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !startDate}
              className="text-xs h-7.5 px-3.5 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-xs"
            >
              <Check className="h-3.5 w-3.5" />
              {submitting ? "Saving..." : leaveToEdit ? "Update Request" : "Submit Request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}




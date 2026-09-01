import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PauseCircle, Utensils, Coffee, Users, Clock, Moon, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface OnHoldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskCode?: string;
  taskTitle?: string;
  onConfirm: (reason: string) => Promise<void> | void;
  loading?: boolean;
}

const PRESET_REASONS = [
  { id: "lunch", label: "Lunch Break", icon: Utensils, text: "Lunch Break" },
  { id: "break", label: "Short Break", icon: Coffee, text: "Short Break / Tea" },
  { id: "meeting", label: "Meeting / Call", icon: Users, text: "Internal / Client Meeting" },
  { id: "waiting", label: "Waiting for Feedback", icon: Clock, text: "Waiting for Client / Feedback" },
  { id: "eod", label: "End of Shift", icon: Moon, text: "End of Working Shift" },
];

export function OnHoldDialog({
  open,
  onOpenChange,
  taskCode,
  taskTitle,
  onConfirm,
  loading = false,
}: OnHoldDialogProps) {
  const [selectedPreset, setSelectedPreset] = useState<string>("lunch");
  const [customText, setCustomText] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSelectPreset = (presetText: string, presetId: string) => {
    setSelectedPreset(presetId);
    if (presetId !== "other") {
      setCustomText("");
    }
  };

  const handleSubmit = async () => {
    const finalReason = selectedPreset === "other" 
      ? customText.trim() || "On Hold"
      : (PRESET_REASONS.find(p => p.id === selectedPreset)?.text || customText.trim() || "On Hold");

    try {
      setIsSubmitting(true);
      await onConfirm(finalReason);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border-border/80 shadow-2xl p-5 space-y-4">
        <DialogHeader className="space-y-1.5 text-left">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <PauseCircle className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
                Pause Task & Put On Hold
              </DialogTitle>
              {taskCode && (
                <span className="font-mono text-xs text-primary font-semibold">
                  {taskCode} {taskTitle && `· ${taskTitle}`}
                </span>
              )}
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-foreground pt-1">
            Select a quick reason for pausing this task. Your system timer will safely pause and save elapsed time.
          </DialogDescription>
        </DialogHeader>

        {/* Quick Presets */}
        <div className="space-y-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-amber-400" /> Choose Quick Reason
          </label>

          <div className="grid grid-cols-2 gap-2">
            {PRESET_REASONS.map((preset) => {
              const Icon = preset.icon;
              const isSelected = selectedPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectPreset(preset.text, preset.id)}
                  className={cn(
                    "flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-all text-left cursor-pointer",
                    isSelected
                      ? "bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-xs ring-1 ring-amber-500/30"
                      : "bg-card hover:bg-accent/40 text-muted-foreground hover:text-foreground border-border/60"
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", isSelected ? "text-amber-400" : "text-muted-foreground")} />
                  <span className="truncate">{preset.label}</span>
                </button>
              );
            })}

            {/* Other option */}
            <button
              type="button"
              onClick={() => setSelectedPreset("other")}
              className={cn(
                "flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-all text-left cursor-pointer",
                selectedPreset === "other"
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-xs ring-1 ring-amber-500/30"
                  : "bg-card hover:bg-accent/40 text-muted-foreground hover:text-foreground border-border/60"
              )}
            >
              <PauseCircle className={cn("h-4 w-4 shrink-0", selectedPreset === "other" ? "text-amber-400" : "text-muted-foreground")} />
              <span>Other Reason</span>
            </button>
          </div>
        </div>

        {/* Custom Text input if other selected or optional notes */}
        {selectedPreset === "other" && (
          <div className="space-y-1.5 animate-in fade-in duration-150">
            <label className="text-[11px] font-medium text-muted-foreground">Specify Reason</label>
            <Textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="e.g. Lunch break, Client meeting, Tea break..."
              rows={2}
              className="text-xs bg-input/40 border-border text-foreground focus-visible:ring-amber-500/40 resize-none"
            />
          </div>
        )}

        <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSubmitting || loading}
            onClick={() => onOpenChange(false)}
            className="h-8 text-xs cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isSubmitting || loading || (selectedPreset === "other" && !customText.trim())}
            onClick={handleSubmit}
            className="h-8 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-slate-950 transition-colors shadow-sm cursor-pointer"
          >
            <PauseCircle className="h-3.5 w-3.5 mr-1.5" />
            {isSubmitting || loading ? "Pausing..." : "Confirm & Put On Hold"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

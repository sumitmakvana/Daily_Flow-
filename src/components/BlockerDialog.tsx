import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function BlockerDialog({
  open,
  onOpenChange,
  onConfirm,
  taskCode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (reason: string) => void;
  taskCode: string;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {taskCode} blocked</DialogTitle>
          <DialogDescription>
            Tell your manager what's blocking this task. They'll get a notification.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reason">Blocker reason</Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Waiting on client approval, API down, etc."
            rows={4}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!reason.trim()}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            Mark blocked
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

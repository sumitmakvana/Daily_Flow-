import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reviewsService } from "@/services/reviews";
import { useInvalidateReviewDecisions } from "@/hooks/use-review-decisions";
import { toast } from "sonner";

export type ReviewDecisionMode = "approved" | "changes_requested";

export interface ReviewerOption {
  id: string;
  name: string;
}

/**
 * Approve (feedback optional) or request changes (feedback mandatory) for ONE reviewer.
 * A reviewer decides for themselves. A manager who is not one of the reviewers passes
 * `onBehalfOf` (the reviewers still pending) and must choose whom they are deciding for.
 */
export function ReviewDecisionDialog({
  open,
  mode,
  taskId,
  taskCode,
  onBehalfOf,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  mode: ReviewDecisionMode;
  taskId: string;
  taskCode: string;
  onBehalfOf?: ReviewerOption[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewerId, setReviewerId] = useState("");
  const invalidate = useInvalidateReviewDecisions();
  const approving = mode === "approved";
  const needsTarget = (onBehalfOf?.length ?? 0) > 0;

  useEffect(() => {
    if (open) {
      setFeedback("");
      setReviewerId(onBehalfOf?.length === 1 ? onBehalfOf[0].id : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId, mode]);

  const blocked = busy || (!approving && !feedback.trim()) || (needsTarget && !reviewerId);

  const submit = async () => {
    if (blocked) return;
    setBusy(true);
    try {
      const target = needsTarget ? reviewerId : undefined;
      if (approving) {
        const r = await reviewsService.approve(taskId, feedback, target);
        toast.success(
          r?.decision === "approved"
            ? `${taskCode} approved by all reviewers and completed`
            : `Approval recorded for ${taskCode}. Waiting for the other reviewers`,
        );
      } else {
        await reviewsService.requestChanges(taskId, feedback, target);
        toast.success(`Changes requested on ${taskCode}`);
      }
      invalidate();
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message || "Could not save your review");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {approving ? `Approve ${taskCode}` : `Request changes on ${taskCode}`}
          </DialogTitle>
          <DialogDescription>
            {approving
              ? "This records your approval only. The task is completed once every reviewer has approved."
              : "The task goes back to In Progress and the assignee is notified with your feedback. Other reviewers' decisions are kept."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {needsTarget && (
            <div className="space-y-1.5">
              <Label htmlFor="review-for">
                Deciding for <span className="text-destructive">*</span>
              </Label>
              <Select value={reviewerId} onValueChange={setReviewerId}>
                <SelectTrigger id="review-for">
                  <SelectValue placeholder="Choose a reviewer" />
                </SelectTrigger>
                <SelectContent>
                  {onBehalfOf!.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                You are not one of the reviewers, so this is recorded as your decision on their
                behalf.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="review-feedback">
              {approving ? "Comment (optional)" : "Feedback"}
              {!approving && <span className="text-destructive"> *</span>}
            </Label>
            <Textarea
              id="review-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={approving ? "Looks good." : "What needs to change?"}
              rows={4}
              maxLength={5000}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={blocked}
            variant={approving ? "default" : "destructive"}
            onClick={submit}
          >
            {busy ? "Saving…" : approving ? "Approve" : "Request changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

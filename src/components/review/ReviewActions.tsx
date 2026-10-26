import { useState } from "react";
import { CheckCircle2, Clock, MessageSquareWarning, SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Profile, Task } from "@/lib/types";
import {
  approvalBlocker,
  canDecideReview,
  canLogReviewHours,
  myDecision,
  pendingReviewerIds,
  submitBlocker,
} from "@/lib/review";
import { reviewSubmitStore } from "@/services/review-submit-store";
import { useReviewDecisions } from "@/hooks/use-review-decisions";
import {
  ReviewDecisionDialog,
  type ReviewDecisionMode,
  type ReviewerOption,
} from "./ReviewDecisionDialog";

/**
 * The review buttons for one task, shown only where they apply:
 *  - In Progress  -> "Send for review" (assignee / manager): opens the dialog where the
 *                    assignee enters or confirms today's logged hours first
 *  - In Review    -> "Update logged hours" (assignee); "Approve" / "Request changes" for a
 *                    reviewer whose OWN status is still pending (each reviewer decides once), or
 *                    for a manager deciding on behalf of a pending reviewer. Never the assignee.
 * The database enforces the same rules; this just avoids offering actions that would fail.
 */
export function ReviewActions({
  task,
  userId,
  isManager,
  onChanged,
  submittedBy,
  profiles = [],
  className,
  size = "sm",
}: {
  task: Task;
  userId: string;
  isManager: boolean;
  onChanged: () => void;
  submittedBy?: string | null;
  profiles?: Pick<Profile, "id" | "display_name">[];
  className?: string;
  size?: "sm" | "default";
}) {
  const [mode, setMode] = useState<ReviewDecisionMode | null>(null);
  const cycle = useReviewDecisions(task);
  const actor = { userId, isManager };

  if (!userId) return null;

  if (task.status === "In Progress") {
    const mayTry = task.assigned_to === userId || isManager;
    if (!mayTry) return null;
    const blocker = submitBlocker(task, actor);
    return (
      <Button
        type="button"
        size={size}
        variant="outline"
        disabled={!!blocker}
        title={blocker ?? "Confirm your logged hours and send this task to its reviewers"}
        onClick={(e) => {
          e.stopPropagation();
          reviewSubmitStore.open(task, "submit", onChanged);
        }}
        className={className}
      >
        <SendHorizonal className="h-3 w-3 mr-1" />
        Send for review
      </Button>
    );
  }

  if (task.status === "In Review") {
    const decisions = cycle.data?.reviewers;
    // Wait for the per-reviewer statuses before offering a decision, so a reviewer who has
    // already decided never sees the buttons flash up.
    const canDecide =
      !cycle.isLoading &&
      canDecideReview(task, actor, submittedBy ?? cycle.data?.submitted_by, decisions);
    const canLog = canLogReviewHours(task, actor);
    if (!canDecide && !canLog) return null;
    const hoursBlocker = approvalBlocker(task);
    // A manager who is not one of the reviewers decides on behalf of a named, pending reviewer.
    const onBehalf: ReviewerOption[] =
      canDecide && !myDecision(decisions, userId)
        ? pendingReviewerIds(decisions).map((id) => ({
            id,
            name: profiles.find((p) => p.id === id)?.display_name ?? "Unknown",
          }))
        : [];
    return (
      <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
        {canLog && (
          <Button
            type="button"
            size={size}
            variant={hoursBlocker ? "default" : "outline"}
            className={className}
            onClick={() => reviewSubmitStore.open(task, "confirm", onChanged)}
          >
            <Clock className="h-3 w-3 mr-1" />
            {hoursBlocker ? "Enter logged hours" : "Update logged hours"}
          </Button>
        )}
        {canDecide && (
          <>
            <Button
              type="button"
              size={size}
              className={className}
              disabled={!!hoursBlocker}
              title={hoursBlocker ?? undefined}
              onClick={() => setMode("approved")}
            >
              <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
            </Button>
            <Button
              type="button"
              size={size}
              variant="outline"
              className={className}
              onClick={() => setMode("changes_requested")}
            >
              <MessageSquareWarning className="h-3 w-3 mr-1" /> Request changes
            </Button>
            <ReviewDecisionDialog
              open={mode !== null}
              mode={mode ?? "approved"}
              taskId={task.id}
              taskCode={task.task_code}
              onBehalfOf={onBehalf}
              onOpenChange={(v) => !v && setMode(null)}
              onDone={onChanged}
            />
          </>
        )}
      </div>
    );
  }

  return null;
}

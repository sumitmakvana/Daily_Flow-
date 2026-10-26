import { useEffect, useState } from "react";
import { Clock, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatHoursMins } from "@/lib/format";
import { formatBetween, formatElapsed, isReviewAging, reviewSubmittedAt } from "@/lib/review";
import { reviewsService } from "@/services/reviews";
import { useMinuteTick } from "@/hooks/use-minute-tick";
import type { Profile, Task, TaskReview } from "@/lib/types";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Submitted 26 Oct, 14:20 · In review 3h 20m" for a task currently In Review. */
export function ReviewTimeline({
  task,
  reviewerName,
  className,
}: {
  task: Pick<Task, "status" | "review_submitted_at" | "updated_at">;
  reviewerName?: string | null;
  className?: string;
}) {
  const inReview = task.status === "In Review";
  useMinuteTick(inReview);
  if (!inReview) return null;
  const submitted = reviewSubmittedAt(task);
  if (!submitted) return null;
  const aging = isReviewAging(submitted);
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground",
        className,
      )}
    >
      <Clock className={cn("h-3 w-3 shrink-0", aging && "text-amber-500")} />
      <span>Submitted {when(submitted)}</span>
      <span aria-hidden>·</span>
      <span className={cn("font-medium", aging ? "text-amber-500" : "text-review")}>
        In review {formatElapsed(submitted)}
      </span>
      {reviewerName && (
        <>
          <span aria-hidden>·</span>
          <span>Reviewer: {reviewerName}</span>
        </>
      )}
    </div>
  );
}

/** "Logged 3h · Tracked 3h 20m", or a warning while the assignee hasn't entered hours yet. */
export function ReviewHours({
  task,
  className,
}: {
  task: Pick<Task, "status" | "actual_hours" | "system_hours">;
  className?: string;
}) {
  if (task.status !== "In Review") return null;
  const logged = Number(task.actual_hours ?? 0);
  const tracked = Number(task.system_hours ?? 0);
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground",
        className,
      )}
    >
      {logged > 0 ? (
        <span>
          Logged <span className="font-medium text-emerald-500">{formatHoursMins(logged)}</span>
        </span>
      ) : (
        <span className="font-medium text-amber-500">Logged hours missing</span>
      )}
      {tracked > 0 && (
        <>
          <span aria-hidden>·</span>
          <span>Timer {formatHoursMins(tracked)}</span>
        </>
      )}
    </div>
  );
}

const DECISION_LABEL: Record<TaskReview["decision"], string> = {
  pending: "Awaiting decision",
  approved: "Approved",
  changes_requested: "Changes requested",
  withdrawn: "Withdrawn",
};

/** Every review cycle on a task, with each reviewer's own decision, who decided, when, and why. */
export function ReviewHistory({
  taskId,
  profiles,
  refreshKey,
}: {
  taskId: string;
  profiles: Pick<Profile, "id" | "display_name">[];
  refreshKey?: string | number;
}) {
  const [cycles, setCycles] = useState<TaskReview[] | null>(null);

  useEffect(() => {
    let alive = true;
    reviewsService
      .listForTask(taskId)
      .then((r) => alive && setCycles(r))
      .catch(() => alive && setCycles([]));
    return () => {
      alive = false;
    };
  }, [taskId, refreshKey]);

  if (!cycles || cycles.length === 0) return null;
  const name = (id: string | null) =>
    id ? (profiles.find((p) => p.id === id)?.display_name ?? "Unknown") : "—";

  return (
    <div className="space-y-2">
      <div className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
        <History className="h-3.5 w-3.5 text-primary" /> Review history
      </div>
      <ul className="space-y-2">
        {cycles.map((c) => (
          <li
            key={c.id}
            className="rounded-lg border border-border/70 bg-muted/20 p-2.5 text-xs space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">Cycle {c.cycle_no}</span>
              <span
                className={cn(
                  "font-medium",
                  c.decision === "approved" && "text-emerald-500",
                  c.decision === "changes_requested" && "text-amber-500",
                  c.decision === "pending" && "text-review",
                )}
              >
                {DECISION_LABEL[c.decision]}
              </span>
            </div>
            <div className="text-muted-foreground">
              Submitted by {name(c.submitted_by)} · {when(c.submitted_at)}
              {c.decided_at && (
                <>
                  {" "}
                  · {c.decision === "withdrawn" ? "closed" : "decided"} {when(c.decided_at)} · took{" "}
                  {formatBetween(c.submitted_at, c.decided_at)}
                </>
              )}
            </div>
            {/* Every reviewer's own status. The cycle's overall status above is derived from these. */}
            {(c.reviewers ?? []).length > 0 ? (
              <ul className="space-y-1 pt-0.5">
                {(c.reviewers ?? []).map((r, i) => (
                  <li key={r.reviewer_id ?? i} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{name(r.reviewer_id)}</span>
                      <span
                        className={cn(
                          r.decision === "approved" && "text-emerald-500",
                          r.decision === "changes_requested" && "text-amber-500",
                          (r.decision === "pending" || r.decision === "withdrawn") &&
                            "text-muted-foreground",
                        )}
                      >
                        {r.decision === "pending" && c.decision !== "pending"
                          ? "Did not decide (review closed)"
                          : DECISION_LABEL[r.decision]}
                      </span>
                    </div>
                    {r.decided_at && (
                      <div className="text-muted-foreground">
                        {when(r.decided_at)}
                        {r.decided_by &&
                          r.decided_by !== r.reviewer_id &&
                          ` · decided by ${name(r.decided_by)} on their behalf`}
                      </div>
                    )}
                    {r.feedback && (
                      <p className="whitespace-pre-wrap text-foreground/90">“{r.feedback}”</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              c.decided_at && (
                <div className="text-muted-foreground">
                  {c.decision === "withdrawn" ? "Closed" : "Decided"} by {name(c.decided_by)}
                </div>
              )
            )}
            {c.logged_hours_confirmed_at && (
              <div className="text-muted-foreground">
                Hours confirmed {when(c.logged_hours_confirmed_at)}:{" "}
                {formatHoursMins(c.logged_hours_today)} today,{" "}
                {formatHoursMins(c.logged_hours_total)} total
                {c.system_hours_total != null &&
                  ` · timer ${formatHoursMins(c.system_hours_total)}`}
              </div>
            )}
            {c.feedback && (c.reviewers ?? []).length === 0 && (
              <p className="whitespace-pre-wrap text-foreground/90">“{c.feedback}”</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

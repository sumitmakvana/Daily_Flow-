import { CheckCircle2, Clock, MessageSquareWarning } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatReviewTime, summarizeReviewers } from "@/lib/review";
import { useReviewDecisions } from "@/hooks/use-review-decisions";
import type { Profile, ReviewerDecision, Task } from "@/lib/types";

type NamedProfile = Pick<Profile, "id" | "display_name">;

const nameOf = (profiles: NamedProfile[], id: string | null) =>
  id ? (profiles.find((p) => p.id === id)?.display_name ?? "Unknown") : "—";

function statusText(d: ReviewerDecision, profiles: NamedProfile[]): string {
  const who = nameOf(profiles, d.reviewer_id);
  const by =
    d.decided_by && d.decided_by !== d.reviewer_id
      ? ` (decided by ${nameOf(profiles, d.decided_by)})`
      : "";
  if (d.decision === "approved") return `${who}: approved${by}`;
  if (d.decision === "changes_requested") return `${who}: requested changes${by}`;
  if (d.decision === "withdrawn") return `${who}: removed from this review`;
  return `${who}: waiting for review`;
}

const ICON = {
  approved: CheckCircle2,
  changes_requested: MessageSquareWarning,
  pending: Clock,
  withdrawn: Clock,
} as const;

/**
 * Each reviewer's OWN status for the current review.
 *  - variant "chips" (default): "2/3 approved" plus one compact chip per reviewer.
 *  - variant "rows": a segmented progress bar and one aligned row per reviewer
 *    (name left, status right), for the In Review panel on cards.
 * Pass `decisions` when you already have them (the Reviews page); otherwise they are fetched for
 * tasks that are In Review.
 */
export function ReviewProgress({
  task,
  profiles,
  decisions,
  variant = "chips",
  className,
}: {
  task: Pick<Task, "id" | "status" | "review_submitted_at">;
  profiles: NamedProfile[];
  decisions?: ReviewerDecision[];
  variant?: "chips" | "rows";
  className?: string;
}) {
  const q = useReviewDecisions(task, decisions === undefined);
  const list = (decisions ?? q.data?.reviewers ?? []).filter((d) => d.decision !== "withdrawn");
  if (task.status !== "In Review" || list.length === 0) return null;
  const sum = summarizeReviewers(list);

  if (variant === "rows") {
    return (
      <div className={cn("space-y-1", className)}>
        <div className="flex items-center justify-between gap-2 text-[11px] leading-tight">
          <span className="font-medium text-foreground">
            {sum.total === 1 ? "Reviewer" : "Reviewers"}
          </span>
          <span
            className={cn(
              "tabular-nums font-medium",
              sum.fullyApproved ? "text-emerald-400" : "text-muted-foreground",
            )}
          >
            {sum.approved}/{sum.total} approved
            {sum.changesRequested > 0 && (
              <span className="text-amber-400"> · {sum.changesRequested} requested changes</span>
            )}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Reviewer approvals"
          aria-valuemin={0}
          aria-valuemax={sum.total}
          aria-valuenow={sum.approved}
          className="flex gap-0.5"
        >
          {list.map((d, i) => (
            <span
              key={d.reviewer_id ?? i}
              className={cn(
                "h-[3px] flex-1 rounded-full",
                d.decision === "approved" && "bg-emerald-400",
                d.decision === "changes_requested" && "bg-amber-400",
                d.decision === "pending" && "bg-slate-600/60",
              )}
            />
          ))}
        </div>
        <ul className="space-y-0.5">
          {list.map((d, i) => {
            const Icon = ICON[d.decision];
            const label =
              d.decision === "approved"
                ? "Approved"
                : d.decision === "changes_requested"
                  ? "Changes requested"
                  : "Waiting";
            return (
              <li
                key={d.reviewer_id ?? i}
                title={statusText(d, profiles)}
                className="flex items-center justify-between gap-2 text-[11px] leading-tight"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon
                    className={cn(
                      "h-3 w-3 shrink-0",
                      d.decision === "approved" && "text-emerald-400",
                      d.decision === "changes_requested" && "text-amber-400",
                      d.decision === "pending" && "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                  <span className="truncate text-foreground/90">
                    {nameOf(profiles, d.reviewer_id)}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-right",
                    d.decision === "approved" && "text-emerald-400",
                    d.decision === "changes_requested" && "text-amber-400",
                    d.decision === "pending" && "text-muted-foreground",
                  )}
                >
                  {label}
                  {d.decided_at && (
                    <span className="hidden text-muted-foreground @md:inline">
                      {" · "}
                      {formatReviewTime(d.decided_at)}
                    </span>
                  )}
                  {d.decided_by && d.decided_by !== d.reviewer_id && (
                    <span className="text-muted-foreground">
                      {" "}
                      · by {nameOf(profiles, d.decided_by)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      <div className="text-[11px] text-muted-foreground">
        Reviewers ·{" "}
        <span
          className={cn("font-medium", sum.fullyApproved ? "text-emerald-500" : "text-foreground")}
        >
          {sum.approved}/{sum.total} approved
        </span>
        {sum.changesRequested > 0 && (
          <span className="text-amber-500"> · {sum.changesRequested} requested changes</span>
        )}
      </div>
      <ul className="flex flex-wrap gap-1">
        {list.map((d, i) => {
          const Icon = ICON[d.decision];
          return (
            <li
              key={d.reviewer_id ?? i}
              title={statusText(d, profiles)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                d.decision === "approved" &&
                  "border-emerald-500/40 text-emerald-500 bg-emerald-500/10",
                d.decision === "changes_requested" &&
                  "border-amber-500/40 text-amber-500 bg-amber-500/10",
                d.decision === "pending" && "border-border text-muted-foreground",
              )}
            >
              <Icon className="h-3 w-3" aria-hidden />
              <span>{nameOf(profiles, d.reviewer_id)}</span>
              <span className="sr-only">{statusText(d, profiles)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

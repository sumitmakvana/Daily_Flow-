import type { ReactNode } from "react";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatHoursMins } from "@/lib/format";
import {
  formatElapsed,
  formatReviewTime,
  isReviewAging,
  reviewSubmittedAt,
  timerGap,
} from "@/lib/review";
import { useMinuteTick } from "@/hooks/use-minute-tick";
import { useReviewDecisions } from "@/hooks/use-review-decisions";
import type { Profile, Task } from "@/lib/types";
import { ReviewProgress } from "./ReviewProgress";

type Tone = "good" | "warn" | "muted";

/** One "label value" pair on a single line; the label column has a fixed width so values align. */
function Stat({
  label,
  value,
  tone = "muted",
  title,
  wide = false,
}: {
  label: string;
  value: string;
  tone?: Tone;
  title?: string;
  /** Span both columns (used for the submission time). */
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-baseline",
        wide && "col-span-2",
      )}
      title={title}
    >
      <dt className="truncate text-[10px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "truncate text-[11px] font-semibold tabular-nums",
          tone === "good" && "text-emerald-400",
          tone === "warn" && "text-amber-400",
          tone === "muted" && "text-foreground/90",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Everything a reader needs about a task that is In Review, in one compact block shared by the
 * board and the list: when it was submitted and how long it has waited, the hours logged against
 * the timer (and the gap between them), and each reviewer's own approval status.
 * `children` (the review actions) sit in a footer that disappears when there are none.
 */
export function ReviewPanel({
  task,
  profiles,
  children,
  className,
}: {
  task: Pick<
    Task,
    "id" | "status" | "review_submitted_at" | "updated_at" | "actual_hours" | "system_hours"
  >;
  profiles: Pick<Profile, "id" | "display_name">[];
  children?: ReactNode;
  className?: string;
}) {
  const inReview = task.status === "In Review";
  useMinuteTick(inReview);
  const cycle = useReviewDecisions(task);
  if (!inReview) return null;

  const submitted = reviewSubmittedAt(task);
  const aging = isReviewAging(submitted);
  const waiting = formatElapsed(submitted);
  const logged = Number(task.actual_hours ?? 0);
  const tracked = Number(task.system_hours ?? 0);
  const gap = timerGap(logged, tracked);
  const cycleNo = cycle.data?.cycle_no ?? 1;

  return (
    <section
      aria-label="Review status"
      className={cn(
        "@container space-y-1.5 rounded-md border border-review/25 bg-review/[0.06] px-2 py-1.5",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-review">
          <Eye className="h-3 w-3 shrink-0" aria-hidden />
          <span>In review</span>
          {cycleNo > 1 && (
            <span className="truncate font-normal normal-case text-muted-foreground">
              · round {cycleNo}
            </span>
          )}
        </div>
        {aging && (
          <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-px text-[10px] font-medium text-amber-300">
            Waiting {waiting}
          </span>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <Stat wide label="Submitted" value={submitted ? formatReviewTime(submitted) : "—"} />
        <Stat label="Waiting" value={waiting} tone={aging ? "warn" : "muted"} />
        <Stat
          label="Logged"
          value={logged > 0 ? formatHoursMins(logged) : "Missing"}
          tone={logged > 0 ? "good" : "warn"}
          title="Hours the assignee logged"
        />
        <Stat
          label="Timer"
          value={tracked > 0 ? formatHoursMins(tracked) : "—"}
          title="Time tracked by the timer"
        />
        <Stat
          label="Timer gap"
          value={gap.label}
          tone={gap.direction === "match" ? "good" : gap.significant ? "warn" : "muted"}
          title={gap.title}
        />
      </dl>

      <div className="border-t border-review/10 pt-1.5">
        <ReviewProgress task={task} profiles={profiles} variant="rows" />
      </div>

      {children && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-review/10 pt-1.5 empty:hidden">
          {children}
        </div>
      )}
    </section>
  );
}

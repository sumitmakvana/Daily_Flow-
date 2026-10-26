import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Inbox } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";
import { reviewsService, type ReviewQueueItem } from "@/services/reviews";
import { ReviewActions } from "@/components/review/ReviewActions";
import { ReviewHours, ReviewTimeline } from "@/components/review/ReviewInfo";
import { ReviewProgress } from "@/components/review/ReviewProgress";
import { useReviewDecisionsRealtime } from "@/hooks/use-review-decisions";
import { PriorityBadge } from "@/components/PriorityBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { Profile, Task, TaskPriority } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/reviews")({
  component: ReviewsPage,
});

type Scope = "mine" | "all";

function ReviewsPage() {
  const { user, isManager, isAdmin } = useAuth();
  const canSeeAll = isManager || isAdmin;
  const [scope, setScope] = useState<Scope>("mine");
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [profiles, setProfiles] = useState<Pick<Profile, "id" | "display_name">[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [queue, { data: p }] = await Promise.all([
        reviewsService.queue(scope),
        supabase.from("profiles").select("id,display_name"),
      ]);
      setItems(queue);
      setProfiles((p ?? []) as Pick<Profile, "id" | "display_name">[]);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Could not load reviews");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // A partial approval by another reviewer does not change the task row, so listen to the
  // per-reviewer decisions as well.
  useReviewDecisionsRealtime(load, `reviews-decisions-${scope}`);

  // Not filtered by reviewer: tasks.reviewer only holds the PRIMARY reviewer, but every reviewer
  // of a task needs to see it move.
  useRealtimeTasks(load, `reviews-rt-${scope}`, { kind: "all" });

  const name = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.id, p.display_name]));
    return (id: string | null) => (id ? (m.get(id) ?? "Unknown") : "Unassigned");
  }, [profiles]);

  if (!user) return null;

  return (
    <div className="max-w-3xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Eye className="h-5 w-5 text-review" /> Reviews
          </h1>
          <p className="text-xs text-muted-foreground">
            {loading
              ? "Loading…"
              : scope === "mine"
                ? `${items.filter((i) => i.my_decision === "pending").length} waiting for your review · ${items.length} in total`
                : `${items.length} task${items.length === 1 ? "" : "s"} in review`}
          </p>
        </div>
        {canSeeAll && (
          <div
            className="inline-flex rounded-lg border border-border p-0.5 bg-muted/30 text-xs"
            role="tablist"
          >
            {(["mine", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={scope === s}
                onClick={() => setScope(s)}
                className={cn(
                  "px-3 py-1.5 rounded-md font-medium transition-colors",
                  scope === s
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "mine" ? "My Reviews" : "All Reviews"}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ul className="space-y-2">
        {items.map((it) => {
          // The queue row carries exactly the fields the review rules and actions look at.
          const task = {
            id: it.id,
            task_code: it.task_code,
            task_name: it.task_name,
            status: "In Review",
            assigned_to: it.assigned_to,
            reviewer: it.reviewer,
            review_submitted_at: it.submitted_at,
            actual_hours: it.actual_hours,
            system_hours: it.system_hours,
            planned_hours: it.planned_hours,
            updated_at: it.submitted_at,
          } as Task;
          return (
            <li key={it.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <Link
                  to="/tasks"
                  search={{ highlightId: it.id }}
                  className="min-w-0 flex-1 hover:underline"
                >
                  <div className="text-sm font-medium truncate">
                    <span className="text-muted-foreground">{it.task_code}</span> · {it.task_name}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {it.project_name ? `${it.project_name} · ` : ""}
                    Assignee {name(it.assigned_to)}
                    {it.due_date ? ` · Due ${formatDate(it.due_date)}` : ""}
                    {it.cycle_no && it.cycle_no > 1 ? ` · Review cycle ${it.cycle_no}` : ""}
                  </div>
                </Link>
                <div className="flex items-center gap-1.5 shrink-0">
                  <PriorityBadge priority={it.priority as TaskPriority} />
                  <StatusBadge status="In Review" />
                </div>
              </div>
              <ReviewTimeline task={task} />
              <ReviewHours task={task} />
              <ReviewProgress task={task} profiles={profiles} decisions={it.reviewers} />
              {scope === "mine" && it.my_decision && it.my_decision !== "pending" && (
                <p className="text-[11px] text-muted-foreground">
                  Your review:{" "}
                  <span className="font-medium">
                    {it.my_decision === "approved" ? "approved" : "changes requested"}
                  </span>
                </p>
              )}
              <ReviewActions
                task={task}
                userId={user.id}
                isManager={canSeeAll}
                submittedBy={it.submitted_by}
                profiles={profiles}
                onChanged={load}
                className="h-8 px-3 text-xs"
              />
            </li>
          );
        })}
      </ul>

      {!loading && items.length === 0 && !error && (
        <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
          <Inbox className="h-8 w-8 opacity-50" />
          <p className="text-sm italic">
            {scope === "mine" ? "Nothing is waiting for your review." : "No tasks are in review."}
          </p>
        </div>
      )}
    </div>
  );
}

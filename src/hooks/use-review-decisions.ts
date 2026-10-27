import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { reviewsService } from "@/services/reviews";
import type { Task, TaskReview } from "@/lib/types";

/** Query-key prefix for everything derived from per-reviewer decisions. */
export const REVIEW_DECISIONS_KEY = ["review-decisions"] as const;

/**
 * The review cycle a task is currently in (its per-reviewer statuses live in `.reviewers`).
 * Falls back to the latest cycle. Only fetched for tasks that are In Review.
 * The key changes with each new submission, and is invalidated after every decision.
 */
export function useReviewDecisions(
  task: Pick<Task, "id" | "status" | "review_submitted_at">,
  enabled = true,
) {
  return useQuery<TaskReview | null>({
    queryKey: [...REVIEW_DECISIONS_KEY, task.id, task.review_submitted_at ?? null],
    enabled: enabled && task.status === "In Review",
    staleTime: 10_000,
    queryFn: async () => {
      const cycles = await reviewsService.listForTask(task.id);
      return cycles.find((c) => c.decision === "pending") ?? cycles[0] ?? null;
    },
  });
}

/**
 * Calls `onChange` whenever any reviewer's decision changes (task_review_decisions realtime),
 * so a partial approval made by someone else shows up without a reload. A partial approval does
 * not modify the task row, so the tasks subscription alone would not notice it.
 */
export function useReviewDecisionsRealtime(
  onChange: () => void,
  channelName = "review-decisions-rt",
) {
  useEffect(() => {
    const ch = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_review_decisions" },
        () => onChange(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName]);
}

/** Refresh every cached per-reviewer view (used after the user's own decision). */
export function useInvalidateReviewDecisions() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: REVIEW_DECISIONS_KEY });
}

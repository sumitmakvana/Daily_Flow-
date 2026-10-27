import { Inbox } from "lucide-react";
import { PriorityBadge } from "@/components/PriorityBadge";
import { formatDate } from "@/lib/format";
import { sortByWaiting } from "@/lib/review";
import type { Profile, Task } from "@/lib/types";
import { ReviewActions } from "./ReviewActions";
import { ReviewPanel } from "./ReviewPanel";

/**
 * Every task currently In Review for the people shown on Team Capacity: who it belongs to, how long
 * it has waited, logged hours against the timer, each reviewer's own status, and the review
 * actions (a manager/admin can approve or request changes, including on a reviewer's behalf).
 */
export function TeamReviewQueue({
  tasks,
  profiles,
  userId,
  isManager,
  onChanged,
  onOpenTask,
}: {
  tasks: Task[];
  profiles: Pick<Profile, "id" | "display_name">[];
  userId: string;
  isManager: boolean;
  onChanged: () => void;
  onOpenTask?: (task: Task) => void;
}) {
  const sorted = sortByWaiting(tasks);
  const nameOf = (id: string | null) =>
    id ? (profiles.find((p) => p.id === id)?.display_name ?? "Unknown") : "Unassigned";

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border/70 bg-card py-10 text-muted-foreground">
        <Inbox className="h-8 w-8 opacity-50" />
        <p className="text-sm italic">No tasks are in review for the current filters.</p>
      </div>
    );
  }

  return (
    <ul
      aria-label="Tasks in review"
      className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
    >
      {sorted.map((task) => (
        <li
          key={task.id}
          className="space-y-2 rounded-xl border border-border/70 border-l-2 border-l-review/60 bg-card p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => onOpenTask?.(task)}
              className="min-w-0 flex-1 text-left hover:underline"
            >
              <div className="truncate text-sm font-medium">
                <span className="text-muted-foreground">{task.task_code}</span> · {task.task_name}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {nameOf(task.assigned_to)}
                {task.project_name ? ` · ${task.project_name}` : ""}
                {task.due_date ? ` · Due ${formatDate(task.due_date)}` : ""}
              </div>
            </button>
            <PriorityBadge priority={task.priority} />
          </div>
          <ReviewPanel task={task} profiles={profiles}>
            <ReviewActions
              task={task}
              userId={userId}
              isManager={isManager}
              onChanged={onChanged}
              profiles={profiles}
              className="h-6 px-2 text-[11px]"
            />
          </ReviewPanel>
        </li>
      ))}
    </ul>
  );
}

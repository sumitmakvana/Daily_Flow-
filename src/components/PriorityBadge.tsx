import { cn } from "@/lib/utils";
import { priorityColor, priorityDot } from "@/lib/colors";
import type { TaskPriority } from "@/lib/types";

export function PriorityBadge({ priority, className }: { priority: TaskPriority; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
        priorityColor[priority],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", priorityDot[priority])} />
      {priority}
    </span>
  );
}

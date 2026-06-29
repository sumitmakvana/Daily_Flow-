import { cn } from "@/lib/utils";
import { statusColor } from "@/lib/colors";
import type { TaskStatus } from "@/lib/types";

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium",
        statusColor[status],
        className,
      )}
    >
      {status}
    </span>
  );
}

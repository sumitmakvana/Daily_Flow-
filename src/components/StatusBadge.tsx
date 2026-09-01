import { cn } from "@/lib/utils";
import { statusColor } from "@/lib/colors";
import type { TaskStatus } from "@/lib/types";

export function StatusBadge({ status, reason, className }: { status: TaskStatus; reason?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
        statusColor[status],
        className,
      )}
      title={reason ? `${status}: ${reason}` : status}
    >
      <span>{status}</span>
      {status === "On Hold" && reason && (
        <span className="opacity-90 font-normal border-l border-amber-500/30 pl-1 ml-0.5 max-w-[130px] truncate">
          ({reason})
        </span>
      )}
    </span>
  );
}

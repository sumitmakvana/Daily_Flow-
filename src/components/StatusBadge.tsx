import { cn } from "@/lib/utils";
import { statusColor } from "@/lib/colors";
import type { TaskStatus } from "@/lib/types";
import { Palmtree } from "lucide-react";

export function StatusBadge({ status, reason, className }: { status: TaskStatus; reason?: string | null; className?: string }) {
  const isLeave = (reason && reason.toLowerCase().includes("leave")) || (status as string)?.toLowerCase().includes("leave");

  if (isLeave) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-300/90 border-amber-500/25",
          className,
        )}
        title={reason ? `On Leave: ${reason}` : "On Leave (Timer Paused)"}
      >
        <Palmtree className="h-3 w-3 shrink-0 text-amber-400/80" />
        <span>Leave</span>
        {reason && (
          <span className="opacity-80 font-normal border-l border-amber-500/20 pl-1 ml-0.5 max-w-[130px] truncate text-[11px]">
            ({reason})
          </span>
        )}
      </span>
    );
  }

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

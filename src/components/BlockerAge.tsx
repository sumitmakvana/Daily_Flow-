import { AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { daysSince } from "@/lib/format";

/**
 * Compact age pill for blocked tasks.
 *   < 1 day  – neutral
 *   ≥ 1 day  – warning (amber)
 *   ≥ 3 days – critical (red)
 */
export function BlockerAge({ blockedAt }: { blockedAt: string | null }) {
  if (!blockedAt) return null;
  const days = daysSince(blockedAt);
  const tone =
    days >= 3
      ? "border-priority-high/50 bg-priority-high/15 text-priority-high"
      : days >= 1
      ? "border-priority-medium/50 bg-priority-medium/15 text-priority-medium"
      : "border-border text-muted-foreground";
  const label = days < 1 ? "today" : days === 1 ? "1d" : `${days}d`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
        tone,
      )}
      title={`Blocked since ${new Date(blockedAt).toLocaleString()}`}
    >
      <AlertOctagon className="h-3 w-3" /> {label}
    </span>
  );
}

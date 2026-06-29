import { cn } from "@/lib/utils";

export function CapacityBar({
  planned,
  actual,
  capacity = 40,
  className,
}: {
  planned: number;
  actual: number;
  capacity?: number;
  className?: string;
}) {
  const plannedPct = Math.min(100, (planned / capacity) * 100);
  const actualPct = Math.min(100, (actual / capacity) * 100);
  const over = planned > capacity;
  return (
    <div className={cn("w-full", className)}>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-all",
            over ? "bg-priority-high" : "bg-primary/70",
          )}
          style={{ width: `${plannedPct}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-status-completed/80"
          style={{ width: `${actualPct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{actual.toFixed(1)}h / {planned.toFixed(1)}h</span>
        <span>{capacity}h cap</span>
      </div>
    </div>
  );
}

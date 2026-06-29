import { ArrowRightCircle } from "lucide-react";

export function CarryForwardBadge({ count }: { count: number }) {
  if (!count) return null;
  const danger = count >= 3;
  return (
    <span
      title={danger ? "Repeatedly delayed" : `Carried forward ${count}×`}
      className={
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs " +
        (danger
          ? "border-priority-high/40 text-priority-high bg-priority-high/10"
          : "border-priority-medium/40 text-priority-medium bg-priority-medium/10")
      }
    >
      <ArrowRightCircle className="h-3 w-3" />
      CF×{count}
    </span>
  );
}

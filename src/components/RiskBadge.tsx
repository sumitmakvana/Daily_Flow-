import { cn } from "@/lib/utils";
import { SEVERITY_TONE, KIND_LABEL } from "@/services/risks";
import type { RiskEvent } from "@/lib/types";
import { AlertTriangle } from "lucide-react";

export function RiskBadge({ risk, className }: { risk: Pick<RiskEvent, "kind" | "severity">; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        SEVERITY_TONE[risk.severity],
        className,
      )}
      title={`${risk.severity.toUpperCase()} · ${KIND_LABEL[risk.kind] ?? risk.kind}`}
    >
      <AlertTriangle className="h-3 w-3" />
      {KIND_LABEL[risk.kind] ?? risk.kind}
    </span>
  );
}

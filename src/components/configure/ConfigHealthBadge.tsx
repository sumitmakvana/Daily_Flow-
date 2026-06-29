import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import type { HealthLevel } from "@/services/config-health";

export function ConfigHealthBadge({ status, label }: { status: HealthLevel; label?: string }) {
  if (status === "ok") {
    return (
      <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-500/50">
        <CheckCircle2 className="h-3 w-3" />{label ?? "Ready"}
      </Badge>
    );
  }
  if (status === "warning") {
    return (
      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-500/50">
        <AlertTriangle className="h-3 w-3" />{label ?? "Needs attention"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-destructive border-destructive/50">
      <AlertCircle className="h-3 w-3" />{label ?? "Not ready"}
    </Badge>
  );
}

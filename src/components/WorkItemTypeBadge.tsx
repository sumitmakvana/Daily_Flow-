import * as Icons from "lucide-react";
import type { WorkItemType } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Small badge showing the work-item type (icon + label).
 * Falls back to a generic icon when the type is unknown.
 */
export function WorkItemTypeBadge({
  type,
  compact,
  className,
}: {
  type?: WorkItemType | null;
  compact?: boolean;
  className?: string;
}) {
  if (!type) return null;
  const IconCmp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
    type.icon ?? "Tag"
  ] ?? Icons.Tag;
  const tokenClass = type.color ? `text-${type.color} border-${type.color}/30 bg-${type.color}/10` : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
        tokenClass || "border-border text-muted-foreground",
        className,
      )}
      title={type.description ?? type.name}
    >
      <IconCmp className="h-3 w-3" />
      {!compact && type.name}
    </span>
  );
}

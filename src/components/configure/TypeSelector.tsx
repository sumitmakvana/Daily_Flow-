import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WorkItemType } from "@/lib/types";

export function TypeSelector({
  types,
  value,
  onChange,
  label = "Work Item Type",
}: {
  types: WorkItemType[];
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
        <SelectContent>
          {types.map((t) => (
            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

import { useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

/**
 * Chip / tag input. Used by FieldsPanel to collect select-option labels
 * without forcing the user to write JSON.
 */
export function TagInput({
  values,
  onChange,
  placeholder = "Type and press Enter…",
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (values.includes(v)) return;
    onChange([...values, v]);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className="rounded-md border border-input p-2 flex flex-wrap gap-1">
      {values.map((v) => (
        <Badge key={v} variant="secondary" className="gap-1 pl-2 pr-1 py-1">
          <span className="text-xs">{v}</span>
          <button
            type="button"
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="hover:text-destructive"
            aria-label={`Remove ${v}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft && add(draft)}
        placeholder={values.length ? "" : placeholder}
        className="flex-1 min-w-[120px] border-0 shadow-none focus-visible:ring-0 h-7 px-1"
      />
    </div>
  );
}

import { useMemo } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MAX_REVIEWERS, cleanReviewerList } from "@/lib/review";
import type { Profile } from "@/lib/types";

type NamedProfile = Pick<Profile, "id" | "display_name">;

/**
 * Pick any number of reviewers for a task. Every selected reviewer reviews independently and the
 * task is only approved when all of them have approved. The first one is the primary reviewer.
 * The assignee is never offered.
 */
export function ReviewerPicker({
  value,
  onChange,
  profiles,
  assigneeId,
  disabled = false,
  disabledReason,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  profiles: NamedProfile[];
  assigneeId?: string | null;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const selected = useMemo(() => cleanReviewerList(value, assigneeId), [value, assigneeId]);
  const options = profiles.filter((p) => p.id !== assigneeId);
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? "Unknown";

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (selected.length < MAX_REVIEWERS) onChange([...selected, id]);
  };

  return (
    <div className="space-y-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            className="h-9 w-full justify-between text-xs font-normal bg-card border-border"
          >
            <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
              {selected.length === 0
                ? "None"
                : selected.length === 1
                  ? nameOf(selected[0])
                  : `${selected.length} reviewers`}
            </span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1 max-h-64 overflow-y-auto">
          {options.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No one to choose from.</p>
          )}
          {options.map((p) => {
            const on = selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(p.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent text-left"
              >
                <span
                  className={cn(
                    "grid h-4 w-4 place-items-center rounded border",
                    on ? "bg-primary border-primary text-primary-foreground" : "border-border",
                  )}
                >
                  {on && <Check className="h-3 w-3" />}
                </span>
                <span className="truncate">{p.display_name}</span>
              </button>
            );
          })}
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {selected.map((id, i) => (
            <li
              key={id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px]"
            >
              <span>{nameOf(id)}</span>
              {i === 0 && selected.length > 1 && (
                <span className="text-muted-foreground">(primary)</span>
              )}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${nameOf(id)}`}
                  onClick={() => toggle(id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {selected.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          Every reviewer reviews on their own; the task is approved only when all have approved.
        </p>
      )}
    </div>
  );
}

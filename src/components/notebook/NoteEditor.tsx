import React from "react";
import { Pin, Palette, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { RichNoteEditor } from "./RichNoteEditor";
import { NOTE_COLORS, NoteItem } from "./noteUtils";

export type NoteDraft = Pick<NoteItem, "title" | "content" | "tags" | "color" | "isPinned"> & {
  images: string[];
};

interface NoteEditorProps {
  value: NoteDraft;
  onChange: (patch: Partial<NoteDraft>) => void;
  /** Compact: body editor only (title lives in the host window's header). */
  compact?: boolean;
  placeholder?: string;
  minHeight?: string;
  className?: string;
}

/** Shared note editor: metadata fields (title, color, pin, tags) + rich text body. */
export function NoteEditor({
  value,
  onChange,
  compact = false,
  placeholder = "Type your comment here...",
  minHeight = "220px",
  className,
}: NoteEditorProps) {
  const [tagInput, setTagInput] = React.useState("");

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== ",") return;
    e.preventDefault();
    const formatted = tagInput.trim().replace(/^#/, "").toLowerCase();
    if (formatted && !value.tags.includes(formatted)) {
      onChange({ tags: [...value.tags, formatted] });
    }
    setTagInput("");
  };

  const body = (
    <RichNoteEditor
      initialContent={value.content}
      onChange={(content) => onChange({ content })}
      images={value.images}
      onImagesChange={(images) => onChange({ images })}
      placeholder={placeholder}
      minHeight={minHeight}
      className={compact ? "border-none bg-transparent shadow-none" : undefined}
    />
  );

  if (compact) return <div className={className}>{body}</div>;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <Input
          placeholder="Note Title (e.g. Sprint 42 Key Architecture)"
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="h-9 text-sm font-semibold bg-input/40 border-border flex-1"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5 border-border shrink-0">
              <Palette className="w-3.5 h-3.5 text-primary" />
              <span className="capitalize">{value.color}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover border-border">
            {NOTE_COLORS.map((c) => (
              <DropdownMenuItem
                key={c}
                onClick={() => onChange({ color: c })}
                className="text-xs capitalize flex items-center justify-between"
              >
                <span>{c}</span>
                {value.color === c && <CheckCircle2 className="w-3.5 h-3.5 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange({ isPinned: !value.isPinned })}
          className={cn(
            "h-9 px-3 text-xs gap-1.5 border-border shrink-0",
            value.isPinned && "bg-amber-500/10 text-amber-400 border-amber-500/30"
          )}
        >
          <Pin className={cn("w-3.5 h-3.5", value.isPinned && "fill-amber-400")} />
          {value.isPinned ? "Pinned" : "Pin"}
        </Button>
      </div>

      <div>
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground">Tags:</span>
          {value.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30"
            >
              #{t}
              <button
                type="button"
                onClick={() => onChange({ tags: value.tags.filter((x) => x !== t) })}
                className="hover:text-destructive"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <Input
          placeholder="Add tag and press Enter (e.g. meeting, sprint, docs)..."
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleAddTag}
          className="h-7 text-xs bg-input/40 border-border"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground block">Note Content</label>
        {body}
      </div>
    </div>
  );
}

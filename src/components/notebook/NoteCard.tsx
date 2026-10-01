import React from "react";
import { Pin, Calendar } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { NoteActions } from "./NoteActions";
import { ImagePreview } from "./ImagePreview";
import { COLOR_MAP, NoteItem } from "./noteUtils";

export type { NoteItem } from "./noteUtils";

interface NoteCardProps {
  note: NoteItem;
  onOpen: (note: NoteItem) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onChangeColor: (id: string, color: NoteItem["color"]) => void;
}

export function NoteTags({ tags }: { tags?: string[] }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t, idx) => (
        <span
          key={idx}
          className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/40"
        >
          #{t}
        </span>
      ))}
    </div>
  );
}

export function NoteCard({
  note,
  onOpen,
  onDelete,
  onTogglePin,
  onChangeColor,
}: NoteCardProps) {
  const style = COLOR_MAP[note.color] || COLOR_MAP.slate;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(note)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen(note);
        }
      }}
      className={cn(
        "group relative cursor-pointer flex flex-col justify-between p-3.5 border rounded-xl transition-all duration-200 shadow-sm hover:shadow-md",
        style.bg,
        style.border
      )}
    >
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-sm text-foreground tracking-tight line-clamp-2 leading-tight">
            {note.title || "Untitled Note"}
          </h3>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(note.id);
            }}
            title={note.isPinned ? "Unpin Note" : "Pin Note"}
            className={cn(
              "p-1 rounded-md transition-colors shrink-0",
              note.isPinned
                ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                : "text-muted-foreground hover:text-foreground hover:bg-accent md:opacity-0 md:group-hover:opacity-100"
            )}
          >
            <Pin className={cn("w-3.5 h-3.5", note.isPinned && "fill-amber-400")} />
          </button>
        </div>

        <div
          className="text-xs text-muted-foreground/90 leading-relaxed mb-3 line-clamp-6 prose prose-invert max-w-none [&_a]:text-primary"
          dangerouslySetInnerHTML={{ __html: note.content }}
        />

        <ImagePreview images={note.images} className="mb-3" />

        <div className="mb-3">
          <NoteTags tags={note.tags} />
        </div>
      </div>

      <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground mt-2">
        <span className="font-mono text-[10px] flex items-center gap-1 text-muted-foreground/80">
          <Calendar className="w-3 h-3" />
          {new Date(note.updatedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>

        <NoteActions
          note={note}
          onChangeColor={(c) => onChangeColor(note.id, c)}
          onDelete={() => onDelete(note.id)}
        />
      </div>
    </Card>
  );
}

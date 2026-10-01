import React from "react";
import { ChevronLeft, FileText, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NoteItem } from "./noteUtils";

interface NoteSwitcherProps {
  notes: NoteItem[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** "menu": back-arrow dropdown (notepad header). "chips": inline tab row (dock bar). */
  variant: "menu" | "chips";
}

/** Shared note switching UI used by the notepad window and the dock bar. */
export function NoteSwitcher({ notes, activeId, onSelect, onNew, variant }: NoteSwitcherProps) {
  if (variant === "chips") {
    return (
      <div className="flex items-center gap-1 border-l border-border/60 pl-1.5 overflow-x-auto max-w-xs sm:max-w-md scrollbar-none">
        {notes.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onSelect(n.id)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] border transition-colors shrink-0 max-w-[130px]",
              n.id === activeId
                ? "bg-primary/20 text-primary border-primary/40 font-semibold"
                : "bg-muted/30 text-muted-foreground border-border/50 hover:bg-accent hover:text-foreground"
            )}
            title={n.title}
          >
            <FileText className="w-3 h-3 shrink-0" />
            <span className="truncate">{n.title || "Note"}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={onNew}
          className="p-1 rounded-md text-muted-foreground hover:text-primary hover:bg-accent/40 transition-colors"
          title="Create New Note"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
          title="Switch Notes"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-h-72 overflow-y-auto bg-popover border-border">
        <div className="p-1 text-[11px] font-mono text-muted-foreground font-semibold flex items-center justify-between">
          <span>YOUR RECENT NOTES</span>
          <button onClick={onNew} className="text-primary hover:underline flex items-center gap-0.5">
            <Plus className="w-3 h-3" /> New
          </button>
        </div>
        <DropdownMenuSeparator />
        {notes.map((n) => (
          <DropdownMenuItem
            key={n.id}
            onClick={() => onSelect(n.id)}
            className={cn(
              "text-xs truncate flex items-center justify-between gap-2 cursor-pointer",
              n.id === activeId && "font-semibold text-primary bg-primary/10"
            )}
          >
            <span className="truncate">{n.title || "Untitled Note"}</span>
            {n.isPinned && <span className="text-[10px] text-amber-400">📌</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

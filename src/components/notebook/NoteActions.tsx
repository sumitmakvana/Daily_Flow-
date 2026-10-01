import React from "react";
import { Trash2, Copy, Edit3, Palette, Check, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  COLOR_MAP,
  NOTE_COLORS,
  NoteItem,
  copyNoteText,
  downloadNoteAsText,
} from "./noteUtils";

interface NoteActionsProps {
  note: Pick<NoteItem, "title" | "content" | "updatedAt" | "color">;
  /** Each action renders only when its handler is provided (copy always renders). */
  onChangeColor?: (color: NoteItem["color"]) => void;
  onExport?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  className?: string;
}

const BTN = "p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors";

/** Shared action buttons (color, copy, export, edit, delete) for every note view. */
export function NoteActions({
  note,
  onChangeColor,
  onExport = true,
  onEdit,
  onDelete,
  className,
}: NoteActionsProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    copyNoteText(note.title, note.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    // Stop propagation so actions inside a clickable card/portal don't trigger the card.
    <div className={cn("flex items-center gap-1", className)} onClick={(e) => e.stopPropagation()}>
      {onChangeColor && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title="Change Note Color" className={BTN}>
              <Palette className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="p-2 bg-popover border-border">
            <div className="grid grid-cols-7 gap-1.5">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChangeColor(c)}
                  className={cn(
                    "w-5 h-5 rounded-full border transition-transform hover:scale-110",
                    COLOR_MAP[c].accent,
                    note.color === c ? "ring-2 ring-primary border-white" : "border-transparent"
                  )}
                />
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <button type="button" onClick={handleCopy} title="Copy Note Text" className={BTN}>
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      {onExport && (
        <button
          type="button"
          onClick={() => downloadNoteAsText(note)}
          title="Export as Text File"
          className={BTN}
        >
          <FileDown className="w-3.5 h-3.5" />
        </button>
      )}

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          title="Edit Note"
          className={cn(BTN, "hover:text-primary hover:bg-primary/10")}
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>
      )}

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="Delete Note"
          className={cn(BTN, "hover:text-destructive hover:bg-destructive/10")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

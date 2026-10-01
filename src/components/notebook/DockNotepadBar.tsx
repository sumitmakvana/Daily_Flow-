import React, { useState } from "react";
import { BookOpen, ChevronUp, ChevronDown } from "lucide-react";
import { useNotes } from "./notesStore";
import { NoteSwitcher } from "./NoteSwitcher";

interface DockNotepadBarProps {
  onOpenNote: (noteId?: string) => void;
  activeNoteId?: string | null;
}

export function DockNotepadBar({ onOpenNote, activeNoteId }: DockNotepadBarProps) {
  const { notes: allNotes } = useNotes();
  const notes = allNotes.slice(0, 4); // up to 4 recent notes in the dock bar
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="hidden md:flex fixed bottom-2 left-4 z-40 items-center gap-1.5 select-none">
      <div className="flex items-center gap-1 max-w-full bg-[#141824]/90 backdrop-blur-md border border-border/80 px-2 py-1 rounded-lg shadow-xl text-xs">
        <button
          type="button"
          onClick={() => onOpenNote()}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-foreground hover:bg-accent/40 font-medium transition-colors"
          title="Open Quick Notepad"
        >
          <BookOpen className="w-3.5 h-3.5 text-primary" />
          <span className="hidden sm:inline font-semibold text-[11px]">Notepad</span>
        </button>

        {!collapsed && (
          <NoteSwitcher
            variant="chips"
            notes={notes}
            activeId={activeNoteId}
            onSelect={(id) => onOpenNote(id)}
            onNew={() => onOpenNote()}
          />
        )}

        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 rounded text-muted-foreground hover:text-foreground"
          title={collapsed ? "Expand notepad dock" : "Collapse notepad dock"}
        >
          {collapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from "react";
import { MoreHorizontal, X, Plus, Maximize2, Minimize2, FilePlus, Trash2, Edit2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NoteEditor } from "./NoteEditor";
import { NoteActions } from "./NoteActions";
import { NoteSwitcher } from "./NoteSwitcher";
import {
  NoteItem,
  htmlToPlainText,
  todayNoteTitle,
  copyNoteText,
} from "./noteUtils";
import { useNotes, createNote, updateNote, deleteNote, flushNotes } from "./notesStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DraggableNotepadModalProps {
  open: boolean;
  onClose: () => void;
  activeNoteId?: string | null;
  onSelectNote?: (id: string) => void;
  onConvertToTask?: (title: string, content: string, images: string[]) => void;
  /** Increment to focus the editor (e.g. from the Alt+N shortcut). */
  focusSignal?: number;
}

export function DraggableNotepadModal({
  open,
  onClose,
  activeNoteId,
  onSelectNote,
  onConvertToTask,
  focusSignal = 0,
}: DraggableNotepadModalProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { notes } = useNotes();
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(activeNoteId || null);
  const currentIdRef = useRef<string | null>(currentNoteId);

  // The open note is read straight from the store (database-backed); nothing is copied locally.
  const currentNote = notes.find((n) => n.id === currentNoteId) || null;
  const title = currentNote ? currentNote.title : todayNoteTitle();
  const contentHtml = currentNote?.content ?? "";
  const images = currentNote?.images ?? [];
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  
  // Position & Drag state
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    if (typeof window === "undefined") return { x: 300, y: 80 };
    return {
      x: Math.max(20, window.innerWidth - 480),
      y: Math.max(50, window.innerHeight - 580),
    };
  });

  // On phones the notepad is a full-screen sheet (no dragging / resizing)
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  // Sync activeNoteId prop change
  useEffect(() => {
    if (activeNoteId) {
      setCurrentNoteId(activeNoteId);
    }
  }, [activeNoteId]);

  // Select the first note when none is selected yet
  useEffect(() => {
    if (open && !currentNote && notes.length > 0) setCurrentNoteId(notes[0].id);
  }, [open, currentNote, notes]);

  useEffect(() => {
    currentIdRef.current = currentNoteId;
  }, [currentNoteId]);

  // Focus the editor whenever the notepad is opened or re-requested
  useEffect(() => {
    if (!open || focusSignal === 0) return;
    const id = requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>("[contenteditable='true']")?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, focusSignal]);

  // Handle Dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (isMaximized || isMobile) return;
    if ((e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("input")) return;
    
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      
      setPosition({
        x: Math.max(10, Math.min(window.innerWidth - 320, dragRef.current.initialX + dx)),
        y: Math.max(10, Math.min(window.innerHeight - 200, dragRef.current.initialY + dy)),
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Every edit goes straight to the store, which debounces and saves to the database.
  const saveCurrentNote = (patch: Partial<Pick<NoteItem, "title" | "content" | "images">>) => {
    const id = currentIdRef.current;
    if (id && notes.some((n) => n.id === id)) {
      updateNote(id, patch);
      return;
    }
    const created = createNote({ title: todayNoteTitle(), tags: ["quick"], ...patch });
    currentIdRef.current = created.id;
    setCurrentNoteId(created.id);
  };

  const handleContentChange = (newHtml: string) => saveCurrentNote({ content: newHtml });
  const handleTitleChange = (newTitle: string) => saveCurrentNote({ title: newTitle });

  // Action: Create New Note
  const handleCreateNew = () => {
    const created = createNote({ title: todayNoteTitle(), tags: ["note"] });
    currentIdRef.current = created.id;
    setCurrentNoteId(created.id);
    toast.success("Created new note");
  };

  // Action: Convert to Task
  const handleConvertNoteToTask = () => {
    const plainText = htmlToPlainText(contentHtml);

    if (onConvertToTask) {
      onConvertToTask(title || "Task from Note", plainText, images);
      toast.success("Opening task creation with note details...");
    }
  };

  // Action: Copy text
  const handleCopyText = () => copyNoteText(title, contentHtml);

  // Action: Delete note
  const handleDeleteCurrent = () => {
    if (!currentNoteId) return;
    const next = notes.filter((n) => n.id !== currentNoteId);
    deleteNote(currentNoteId);
    if (next.length > 0) {
      setCurrentNoteId(next[0].id);
    } else {
      handleCreateNew();
    }
    toast.success("Note deleted");
  };

  const handleClose = () => {
    flushNotes();
    onClose();
  };

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      style={{
        left: isMaximized || isMobile ? 0 : `${Math.min(position.x, Math.max(0, window.innerWidth - 440))}px`,
        top: isMaximized || isMobile ? 0 : `${position.y}px`,
        width: isMaximized || isMobile ? "100vw" : "440px",
        height: isMaximized || isMobile ? "100dvh" : "520px",
      }}
      className={cn(
        "fixed z-50 flex flex-col bg-[#141824] border border-border/80 shadow-2xl transition-shadow overflow-hidden select-none",
        isMobile ? "rounded-none" : "rounded-xl",
        isDragging && "cursor-grabbing opacity-95 shadow-2xl scale-[1.01]"
      )}
    >
      {/* Header Bar - ClickUp Style Draggable Header */}
      <div
        onMouseDown={handleMouseDown}
        className="flex items-center justify-between px-3.5 py-2.5 bg-[#1a2030] border-b border-border/70 cursor-grab active:cursor-grabbing text-foreground"
      >
        {/* Left Side: Back / Switch Note */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <NoteSwitcher
            variant="menu"
            notes={notes}
            activeId={currentNoteId}
            onNew={handleCreateNew}
            onSelect={(id) => {
              setCurrentNoteId(id);
            }}
          />

          {/* Editable Note Title */}
          {isEditingTitle ? (
            <Input
              autoFocus
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              onBlur={() => setIsEditingTitle(false)}
              onKeyDown={(e) => e.key === "Enter" && setIsEditingTitle(false)}
              className="h-6 text-xs font-medium bg-input/60 border-border py-0 px-1.5 max-w-[200px]"
            />
          ) : (
            <span
              onClick={() => setIsEditingTitle(true)}
              className="text-xs font-semibold text-foreground/95 truncate hover:text-primary cursor-pointer transition-colors max-w-[220px]"
              title="Click to rename note"
            >
              {title || "Untitled Note"}
            </span>
          )}
        </div>

        {/* Right Side: Options Menu (...) & Window Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Options Dropdown (...) matching ClickUp screenshot */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                title="More Options"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-popover border-border">
              <DropdownMenuItem onClick={() => setIsEditingTitle(true)} className="text-xs gap-2 cursor-pointer">
                <Edit2 className="w-3.5 h-3.5 text-muted-foreground" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleConvertNoteToTask} className="text-xs gap-2 cursor-pointer font-medium text-primary">
                <Plus className="w-3.5 h-3.5 text-primary" /> Convert to Task
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyText} className="text-xs gap-2 cursor-pointer">
                <FilePlus className="w-3.5 h-3.5 text-muted-foreground" /> Convert to Doc / Copy
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleDeleteCurrent} className="text-xs gap-2 text-destructive cursor-pointer">
                <Trash2 className="w-3.5 h-3.5" /> Delete Note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Close Window Button */}
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-destructive/20 transition-colors"
            title="Close Note"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Editor Body */}
      <div className="flex-1 overflow-y-auto bg-[#10141f] p-3">
        <NoteEditor
          compact
          value={{ title, content: contentHtml, images, tags: [], color: "slate", isPinned: false }}
          onChange={(patch) => {
            if (patch.content !== undefined) handleContentChange(patch.content);
            if (patch.images !== undefined) {
              saveCurrentNote({ images: patch.images });
            }
          }}
          placeholder="Write or type '/' for commands and notes..."
          minHeight="240px"
        />
      </div>

      {/* Footer Toolbar - Matching ClickUp Bottom Toolbar Controls */}
      <div className="px-3 py-2 bg-[#1a2030] border-t border-border/70 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <NoteActions note={{ title, content: contentHtml, updatedAt: "", color: "slate" }} onExport={false} />

          {/* New Note button */}
          <button
            type="button"
            onClick={handleCreateNew}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40"
            title="New Note"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Quick Convert to Task button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConvertNoteToTask}
            className="px-2 py-0.5 rounded text-[11px] font-medium bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Convert to Task
          </button>

          {/* Expand/Minimize toggle */}
          <button
            type="button"
            onClick={() => setIsMaximized(!isMaximized)}
            className="hidden sm:block p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40"
            title={isMaximized ? "Restore Size" : "Maximize Window"}
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

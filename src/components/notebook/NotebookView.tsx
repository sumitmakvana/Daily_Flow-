import React, { useState, useEffect, useRef } from "react";
import {
  BookOpen,
  Plus,
  Search,
  Grid,
  List as ListIcon,
  Pin,
  Trash2,
  Download,
  Filter,
  Sparkles,
  Tag as TagIcon,
  Palette,
  FileText,
  RotateCcw,
  CheckCircle2,
  X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NoteCard } from "./NoteCard";
import { NoteEditor } from "./NoteEditor";
import { NoteItem } from "./noteUtils";
import {
  useNotes,
  createNote,
  updateNote,
  deleteNote,
  clearAllNotes,
  flushNotes,
} from "./notesStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function NotebookView() {
  const { notes, status } = useNotes();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Editor modal: the note being edited lives in the store (and DB); there is no draft.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const editingNote = notes.find((n) => n.id === editingNoteId) || null;

  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const handleNewNote = () => {
    setEditingNoteId(createNote().id);
  };

  const handleEditNote = (note: NoteItem) => setEditingNoteId(note.id);

  // Close never discards: pending edits are flushed; a note left completely blank is dropped.
  const handleCloseEditor = () => {
    const n = editingNote;
    if (n && !n.title.trim() && !n.content.replace(/<[^>]*>|&nbsp;/g, "").trim() && (n.images || []).length === 0) {
      deleteNote(n.id);
    } else {
      flushNotes();
    }
    setEditingNoteId(null);
  };

  const handleTogglePin = (id: string) => {
    const n = notes.find((x) => x.id === id);
    if (n) updateNote(id, { isPinned: !n.isPinned }, { immediate: true });
  };

  const handleChangeColor = (id: string, newColor: NoteItem["color"]) =>
    updateNote(id, { color: newColor }, { immediate: true });

  const handleDeleteNote = (id: string) => {
    deleteNote(id);
    toast.success("Note removed");
  };

  const handleClearAllNotes = async () => {
    setClearDialogOpen(false);
    await clearAllNotes();
    toast.success("All notebook data has been cleared");
  };

  // Export All Notes
  const handleExportAll = () => {
    const dataStr = JSON.stringify(notes, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily_flow_notes_export_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("All notes exported as JSON file");
  };

  // Get all unique tags across notes
  const allUniqueTags = Array.from(
    new Set(notes.flatMap((n) => n.tags || []))
  );

  // Filter notes
  const filteredNotes = notes.filter((n) => {
    const matchesSearch =
      !searchQuery ||
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTag = !selectedTag || (n.tags && n.tags.includes(selectedTag));
    const matchesColor = !selectedColor || n.color === selectedColor;
    return matchesSearch && matchesTag && matchesColor;
  });

  const pinnedNotes = filteredNotes.filter((n) => n.isPinned);
  const otherNotes = filteredNotes.filter((n) => !n.isPinned);

  return (
    <div className="pt-6 pb-28 md:pb-6 px-3 sm:px-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                Notebook & Keep Notes
              </h1>
              <p className="text-xs text-muted-foreground">
                Write important notes, store references, paste images & keep checklist items.
              </p>
            </div>
          </div>
        </div>

        {/* Top Control Buttons */}
        <div className="flex items-center flex-wrap gap-2">
          {notes.length > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportAll}
                className="h-8 text-xs gap-1.5 border-border"
              >
                <Download className="w-3.5 h-3.5 text-muted-foreground" />
                Export Notes
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setClearDialogOpen(true)}
                className="h-8 text-xs gap-1.5 border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Clear All Data
              </Button>
            </>
          )}

          <Button
            size="sm"
            onClick={handleNewNote}
            className="h-8 text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Note
          </Button>
        </div>
      </div>

      {/* Quick Search & Filter Controls */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border shadow-sm">
        {/* Search Bar */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search notes by title or keyword..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-8 text-xs bg-input/40 border-border"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filters & View Toggles */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Color Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 border-border">
                <Palette className="w-3.5 h-3.5 text-muted-foreground" />
                {selectedColor ? (
                  <span className="capitalize">{selectedColor}</span>
                ) : (
                  "All Colors"
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover border-border">
              <DropdownMenuItem onClick={() => setSelectedColor(null)} className="text-xs">
                All Colors
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedColor("slate")} className="text-xs">
                Default Slate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedColor("indigo")} className="text-xs">
                Indigo Accent
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedColor("emerald")} className="text-xs">
                Emerald Accent
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedColor("amber")} className="text-xs">
                Amber Accent
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedColor("rose")} className="text-xs">
                Rose Accent
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedColor("cyan")} className="text-xs">
                Cyan Accent
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedColor("purple")} className="text-xs">
                Purple Accent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Grid vs List view toggle */}
          <div className="flex items-center bg-muted/40 p-0.5 rounded-lg border border-border/60">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-1.5 rounded-md transition-colors text-xs flex items-center gap-1",
                viewMode === "grid" ? "bg-card text-foreground shadow-xs font-medium" : "text-muted-foreground hover:text-foreground"
              )}
              title="Grid View"
            >
              <Grid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "p-1.5 rounded-md transition-colors text-xs flex items-center gap-1",
                viewMode === "list" ? "bg-card text-foreground shadow-xs font-medium" : "text-muted-foreground hover:text-foreground"
              )}
              title="List View"
            >
              <ListIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Unique Tag Filter Chips */}
      {allUniqueTags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto pb-1">
          <span className="text-[11px] font-medium text-muted-foreground mr-1 flex items-center gap-1">
            <TagIcon className="w-3 h-3" /> Tags:
          </span>
          <button
            onClick={() => setSelectedTag(null)}
            className={cn(
              "px-2 py-0.5 rounded-full text-[11px] font-mono border transition-colors",
              !selectedTag
                ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                : "bg-muted/40 text-muted-foreground border-border hover:bg-accent"
            )}
          >
            All ({notes.length})
          </button>
          {allUniqueTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={cn(
                "px-2 py-0.5 rounded-full text-[11px] font-mono border transition-colors",
                selectedTag === tag
                  ? "bg-primary/20 text-primary border-primary/50 font-semibold"
                  : "bg-muted/30 text-muted-foreground border-border/60 hover:bg-accent"
              )}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* Main Content Area */}
      {status !== "ready" && notes.length === 0 ? (
        <div className="py-16 text-center text-xs text-muted-foreground">
          {status === "error" ? "Could not load notes. Please refresh." : "Loading notes…"}
        </div>
      ) : filteredNotes.length === 0 ? (
        <Card className="p-12 text-center border-dashed border-border bg-card/40 flex flex-col items-center justify-center space-y-3">
          <div className="p-3 rounded-full bg-muted/60 text-muted-foreground">
            <FileText className="w-8 h-8" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-foreground">No notes found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              {searchQuery || selectedTag || selectedColor
                ? "No notes match your current search or filter criteria."
                : "Your notebook is empty. Create your first note with rich text & images."}
            </p>
          </div>
          <Button size="sm" onClick={handleNewNote} className="h-8 text-xs gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Create Note
          </Button>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Pinned Notes Section */}
          {pinnedNotes.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 uppercase tracking-wider font-mono">
                <Pin className="w-3.5 h-3.5 fill-amber-400" />
                Pinned Notes ({pinnedNotes.length})
              </div>
              <div
                className={cn(
                  viewMode === "grid"
                    ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5"
                    : "flex flex-col gap-3"
                )}
              >
                {pinnedNotes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onOpen={handleEditNote}
                    onDelete={handleDeleteNote}
                    onTogglePin={handleTogglePin}
                    onChangeColor={handleChangeColor}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Other Notes Section */}
          {otherNotes.length > 0 && (
            <div className="space-y-3">
              {pinnedNotes.length > 0 && (
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-mono pt-2 border-t border-border/40">
                  Other Notes ({otherNotes.length})
                </div>
              )}
              <div
                className={cn(
                  viewMode === "grid"
                    ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5"
                    : "flex flex-col gap-3"
                )}
              >
                {otherNotes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    onOpen={handleEditNote}
                    onDelete={handleDeleteNote}
                    onTogglePin={handleTogglePin}
                    onChangeColor={handleChangeColor}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Note Editor Modal — auto-saves to the database; X only closes */}
      <Dialog open={!!editingNote} onOpenChange={(o) => !o && handleCloseEditor()}>
        <DialogContent className="max-w-2xl bg-card border-border p-4 md:p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-3 border-b border-border/60">
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              Edit Note
            </DialogTitle>
          </DialogHeader>

          {editingNote && (
            <div className="py-3">
              <NoteEditor
                value={{
                  title: editingNote.title,
                  content: editingNote.content,
                  tags: editingNote.tags || [],
                  color: editingNote.color,
                  isPinned: editingNote.isPinned,
                  images: editingNote.images || [],
                }}
                onChange={(patch) => updateNote(editingNote.id, patch)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Clear All Data Modal */}
      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" /> Clear All Notebook Data?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground pt-1">
              This action will delete all saved notes and images stored in this notebook. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-border/60">
            <Button variant="outline" size="sm" onClick={() => setClearDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleClearAllNotes}>
              Yes, Clear Data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import React, { useState, useEffect } from "react";
import {
  BookOpen,
  Plus,
  Search,
  X,
  Pin,
  Trash2,
  Copy,
  ExternalLink,
  CheckCircle2,
  FileText,
  ChevronRight,
  Minimize2,
  Maximize2,
  Edit3,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RichNoteEditor } from "./RichNoteEditor";
import { NoteItem } from "./NoteCard";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "daily_flow_notebook_notes_v1";

export function QuickNotesWidget() {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [color, setColor] = useState<NoteItem["color"]>("indigo");
  const [images, setImages] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Load notes from localStorage
  const loadNotes = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setNotes(parsed);
          return;
        }
      }
    } catch {
      // ignore
    }
    setNotes([]);
  };

  useEffect(() => {
    if (open) {
      loadNotes();
    }
  }, [open]);

  // Persist notes changes
  const saveNotesToStorage = (updatedNotes: NoteItem[]) => {
    setNotes(updatedNotes);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedNotes));
    } catch (e) {
      console.warn("Failed to save quick notes:", e);
    }
  };

  const handleSaveNote = () => {
    if (!title.trim() && !contentHtml.trim()) {
      toast.error("Please enter a note title or content");
      return;
    }

    const now = new Date().toISOString();

    if (editingId) {
      const next = notes.map((n) =>
        n.id === editingId
          ? {
              ...n,
              title: title.trim() || "Quick Note",
              content: contentHtml,
              color,
              images,
              updatedAt: now,
            }
          : n
      );
      saveNotesToStorage(next);
      toast.success("Note updated");
    } else {
      const newNote: NoteItem = {
        id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        title: title.trim() || "Quick Note",
        content: contentHtml,
        tags: ["quick"],
        color: color,
        isPinned: false,
        images,
        createdAt: now,
        updatedAt: now,
      };
      saveNotesToStorage([newNote, ...notes]);
      toast.success("Quick note saved");
    }

    // Reset form
    setTitle("");
    setContentHtml("");
    setImages([]);
    setEditingId(null);
    setIsCreating(false);
  };

  const handleTogglePin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = notes.map((n) =>
      n.id === id ? { ...n, isPinned: !n.isPinned } : n
    );
    saveNotesToStorage(next);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = notes.filter((n) => n.id !== id);
    saveNotesToStorage(next);
    toast.success("Note deleted");
  };

  const handleCopyText = (note: NoteItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = note.content;
    const plainText = `${note.title}\n\n${tempDiv.innerText || tempDiv.textContent}`;
    navigator.clipboard.writeText(plainText);
    toast.success("Copied note text");
  };

  const handleEdit = (note: NoteItem) => {
    setEditingId(note.id);
    setTitle(note.title);
    setContentHtml(note.content);
    setColor(note.color);
    setImages(note.images || []);
    setIsCreating(true);
  };

  const filteredNotes = notes.filter(
    (n) =>
      !searchQuery ||
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      {/* Floating Action Button on all pages (Bottom Right) */}
      <div className="fixed bottom-5 right-5 z-40 flex items-center gap-2">
        <Button
          type="button"
          onClick={() => setOpen(true)}
          className="h-11 px-3.5 rounded-full bg-primary text-primary-foreground font-semibold text-xs shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center gap-2 border border-primary/20"
        >
          <BookOpen className="w-4 h-4" />
          <span className="hidden sm:inline">Quick Notes</span>
          {notes.length > 0 && (
            <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-primary-foreground/20 text-primary-foreground text-[10px] font-mono font-bold">
              {notes.length}
            </span>
          )}
        </Button>
      </div>

      {/* Slide-Over Drawer Sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md bg-card border-l border-border p-0 flex flex-col h-full shadow-2xl">
          {/* Drawer Header */}
          <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                <BookOpen className="w-4 h-4" />
              </div>
              <div>
                <SheetTitle className="text-sm font-bold text-foreground">
                  Quick Notes Pad
                </SheetTitle>
                <SheetDescription className="text-[11px] text-muted-foreground">
                  Jot down ideas, snippets & notes anytime.
                </SheetDescription>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <SheetTrigger asChild>
                <Link
                  to="/notebook"
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-primary hover:bg-accent transition-colors flex items-center gap-1"
                  title="Open Full Notebook Page"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Full Page</span>
                </Link>
              </SheetTrigger>
            </div>
          </div>

          {/* Body Section */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {!isCreating ? (
              <>
                {/* Search & New Note Action */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search notes..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 h-8 text-xs bg-input/40 border-border"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingId(null);
                      setTitle("");
                      setContentHtml("");
                      setImages([]);
                      setIsCreating(true);
                    }}
                    className="h-8 px-2.5 text-xs gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" /> Note
                  </Button>
                </div>

                {/* Notes list */}
                {filteredNotes.length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground space-y-2 border border-dashed border-border rounded-lg bg-muted/10 p-4">
                    <FileText className="w-8 h-8 mx-auto text-muted-foreground/60" />
                    <p className="text-xs">No notes found.</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsCreating(true)}
                      className="h-7 text-xs"
                    >
                      Write Quick Note
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredNotes.map((note) => (
                      <div
                        key={note.id}
                        onClick={() => handleEdit(note)}
                        className={cn(
                          "group relative p-3 rounded-lg border transition-all cursor-pointer hover:shadow-xs",
                          note.isPinned
                            ? "bg-amber-950/20 border-amber-500/30"
                            : "bg-card border-border/70 hover:border-primary/40 hover:bg-accent/30"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className="font-semibold text-xs text-foreground line-clamp-1">
                            {note.title || "Untitled Note"}
                          </h4>
                          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={(e) => handleTogglePin(note.id, e)}
                              className={cn(
                                "p-0.5 rounded text-muted-foreground hover:text-foreground",
                                note.isPinned && "text-amber-400"
                              )}
                              title="Pin note"
                            >
                              <Pin className={cn("w-3 h-3", note.isPinned && "fill-amber-400")} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleCopyText(note, e)}
                              className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                              title="Copy text"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDelete(note.id, e)}
                              className="p-0.5 rounded text-muted-foreground hover:text-destructive"
                              title="Delete note"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div
                          className="text-[11px] text-muted-foreground line-clamp-3 prose prose-invert max-w-none"
                          dangerouslySetInnerHTML={{ __html: note.content }}
                        />

                        {note.images && note.images.length > 0 && (
                          <div className="mt-2 text-[10px] text-primary font-mono flex items-center gap-1">
                            📷 {note.images.length} attached image(s)
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              /* Inline Form Editor */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">
                    {editingId ? "Edit Quick Note" : "Create Quick Note"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>

                <Input
                  placeholder="Note Title (e.g. Call Summary, Code Snippet)"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-8 text-xs font-semibold bg-input/40 border-border"
                />

                <RichNoteEditor
                  initialContent={contentHtml}
                  onChange={setContentHtml}
                  images={images}
                  onImagesChange={setImages}
                  placeholder="Type your comment here..."
                  minHeight="140px"
                />

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsCreating(false)}
                    className="h-7 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveNote} className="h-7 text-xs gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Save Note
                  </Button>
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

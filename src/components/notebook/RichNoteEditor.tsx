import React, { useRef, useEffect, useState } from "react";
import {
  Bold,
  Italic,
  Underline,
  ListOrdered,
  List,
  Link as LinkIcon,
  Image as ImageIcon,
  RemoveFormatting,
  X,
  Plus,
  Trash2,
  Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";

interface RichNoteEditorProps {
  initialContent?: string;
  placeholder?: string;
  onChange?: (contentHtml: string) => void;
  images?: string[];
  onImagesChange?: (images: string[]) => void;
  minHeight?: string;
  className?: string;
  onClearContent?: () => void;
}

export function RichNoteEditor({
  initialContent = "",
  placeholder = "Type your comment here...",
  onChange,
  images = [],
  onImagesChange,
  minHeight = "160px",
  className,
  onClearContent,
}: RichNoteEditorProps) {
  // Always-current images so multi-file uploads / async reads do not use a stale list
  const imagesRef = useRef<string[]>(images);
  imagesRef.current = images;
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");

  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");

  const [isFocused, setIsFocused] = useState(false);
  const [activeFormats, setActiveFormats] = useState<{ [key: string]: boolean }>({});

  // Placeholder visibility is state (not a render-time ref read) so it updates after content is injected
  const [isEmpty, setIsEmpty] = useState(!initialContent);
  const computeEmpty = () => {
    const el = editorRef.current;
    if (!el) return true;
    if (el.querySelector("img,li,a")) return false;
    return el.innerText.trim() === "";
  };

  // Initialize editor content
  useEffect(() => {
    if (editorRef.current) {
      if (editorRef.current.innerHTML !== initialContent) {
        editorRef.current.innerHTML = initialContent || "";
      }
      setIsEmpty(computeEmpty());
    }
  }, [initialContent]);

  const handleInput = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      setIsEmpty(computeEmpty());
      onChange?.(html);
      checkActiveFormats();
    }
  };

  const checkActiveFormats = () => {
    if (typeof window === "undefined" || !document) return;
    try {
      setActiveFormats({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        insertOrderedList: document.queryCommandState("insertOrderedList"),
        insertUnorderedList: document.queryCommandState("insertUnorderedList"),
      });
    } catch {
      // Command state query might fail in some selection cases
    }
  };

  const execCmd = (command: string, value: string | undefined = undefined) => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand(command, false, value);
      handleInput();
      checkActiveFormats();
    }
  };

  const handleClearFormatting = () => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand("removeFormat", false);
      // Remove inline styles or spans if any exist
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (range.collapsed) {
          // If no selection, select all text and clear
          document.execCommand("selectAll", false);
          document.execCommand("removeFormat", false);
          window.getSelection()?.removeAllRanges();
        }
      }
      handleInput();
    }
  };

  const handleInsertLink = () => {
    if (!linkUrl) return;
    const finalUrl = linkUrl.startsWith("http://") || linkUrl.startsWith("https://") 
      ? linkUrl 
      : `https://${linkUrl}`;
    
    if (editorRef.current) {
      editorRef.current.focus();
      if (linkText) {
        const linkHtml = `<a href="${finalUrl}" target="_blank" rel="noopener noreferrer" class="text-primary underline hover:text-primary/80">${linkText}</a>`;
        document.execCommand("insertHTML", false, linkHtml);
      } else {
        document.execCommand("createLink", false, finalUrl);
      }
      handleInput();
    }
    setLinkUrl("");
    setLinkText("");
    setLinkDialogOpen(false);
  };

  const handleAddImageFromUrl = () => {
    if (!imageUrl) return;
    if (onImagesChange) {
      imagesRef.current = [...imagesRef.current, imageUrl];
      onImagesChange(imagesRef.current);
    } else if (editorRef.current) {
      editorRef.current.focus();
      const imgHtml = `<img src="${imageUrl}" alt="Uploaded image" class="max-w-full rounded-md my-2 border border-border shadow-sm max-h-96 object-contain" />`;
      document.execCommand("insertHTML", false, imgHtml);
      handleInput();
    }
    setImageUrl("");
    setImageDialogOpen(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) {
          if (onImagesChange) {
            imagesRef.current = [...imagesRef.current, result];
          onImagesChange(imagesRef.current);
          } else if (editorRef.current) {
            editorRef.current.focus();
            const imgHtml = `<img src="${result}" alt="${file.name}" class="max-w-full rounded-md my-2 border border-border shadow-sm max-h-96 object-contain" />`;
            document.execCommand("insertHTML", false, imgHtml);
            handleInput();
          }
        }
      };
      reader.readAsDataURL(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    if (onImagesChange) {
      const next = [...imagesRef.current];
      next.splice(index, 1);
      imagesRef.current = next;
      onImagesChange(next);
    }
  };


  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card shadow-sm transition-all focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/40",
        className
      )}
    >
      {/* Format Toolbar - Exactly matching user requested screenshot */}
      <div className="flex items-center flex-wrap gap-1 px-3 py-2 border-b border-border/70 bg-muted/20 select-none">
        {/* Bold (B) */}
        <button
          type="button"
          onClick={() => execCmd("bold")}
          title="Bold (Ctrl+B)"
          className={cn(
            "h-7 w-7 inline-flex items-center justify-center rounded text-sm font-bold transition-colors hover:bg-accent hover:text-accent-foreground",
            activeFormats.bold ? "bg-accent text-primary font-extrabold" : "text-foreground/80"
          )}
        >
          <Bold className="w-3.5 h-3.5" />
        </button>

        {/* Italic (I) */}
        <button
          type="button"
          onClick={() => execCmd("italic")}
          title="Italic (Ctrl+I)"
          className={cn(
            "h-7 w-7 inline-flex items-center justify-center rounded text-sm italic transition-colors hover:bg-accent hover:text-accent-foreground",
            activeFormats.italic ? "bg-accent text-primary" : "text-foreground/80"
          )}
        >
          <Italic className="w-3.5 h-3.5" />
        </button>

        {/* Underline (U) */}
        <button
          type="button"
          onClick={() => execCmd("underline")}
          title="Underline (Ctrl+U)"
          className={cn(
            "h-7 w-7 inline-flex items-center justify-center rounded text-sm underline transition-colors hover:bg-accent hover:text-accent-foreground",
            activeFormats.underline ? "bg-accent text-primary" : "text-foreground/80"
          )}
        >
          <Underline className="w-3.5 h-3.5" />
        </button>

        <div className="h-4 w-px bg-border/60 mx-1" />

        {/* Numbered List */}
        <button
          type="button"
          onClick={() => execCmd("insertOrderedList")}
          title="Numbered List"
          className={cn(
            "h-7 w-7 inline-flex items-center justify-center rounded transition-colors hover:bg-accent hover:text-accent-foreground",
            activeFormats.insertOrderedList ? "bg-accent text-primary" : "text-foreground/80"
          )}
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </button>

        {/* Bullet List */}
        <button
          type="button"
          onClick={() => execCmd("insertUnorderedList")}
          title="Bullet List"
          className={cn(
            "h-7 w-7 inline-flex items-center justify-center rounded transition-colors hover:bg-accent hover:text-accent-foreground",
            activeFormats.insertUnorderedList ? "bg-accent text-primary" : "text-foreground/80"
          )}
        >
          <List className="w-3.5 h-3.5" />
        </button>

        <div className="h-4 w-px bg-border/60 mx-1" />

        {/* Hyperlink */}
        <button
          type="button"
          onClick={() => setLinkDialogOpen(true)}
          title="Insert Link"
          className="h-7 w-7 inline-flex items-center justify-center rounded text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <LinkIcon className="w-3.5 h-3.5" />
        </button>

        {/* Insert Image */}
        <button
          type="button"
          onClick={() => setImageDialogOpen(true)}
          title="Insert Image"
          className="h-7 w-7 inline-flex items-center justify-center rounded text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <ImageIcon className="w-3.5 h-3.5" />
        </button>

        {/* Clear Formatting (Tx) */}
        <button
          type="button"
          onClick={handleClearFormatting}
          title="Clear Formatting"
          className="h-7 w-7 inline-flex items-center justify-center rounded text-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <RemoveFormatting className="w-3.5 h-3.5" />
        </button>

        {/* Clear Content Action if handler provided */}
        {onClearContent && (
          <button
            type="button"
            onClick={onClearContent}
            title="Clear all text"
            className="ml-auto h-7 px-2 inline-flex items-center gap-1 text-[11px] rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/*"
        multiple
        className="hidden"
      />

      {/* Content Editable Body */}
      <div className="relative p-3.5">
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyUp={checkActiveFormats}
          onMouseUp={checkActiveFormats}
          style={{ minHeight }}
          className="outline-none text-sm text-foreground leading-relaxed font-normal overflow-y-auto max-h-[500px] prose prose-invert max-w-none [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4 [&_a]:text-primary [&_a]:underline"
        />

        {/* Floating Placeholder when empty */}
        {isEmpty && !isFocused && (
          <div
            onClick={() => editorRef.current?.focus()}
            className="absolute top-3.5 left-3.5 text-sm text-muted-foreground/60 italic pointer-events-none select-none"
          >
            {placeholder}
          </div>
        )}
      </div>

      {/* Embedded / Attached Images Preview Bar */}
      {images.length > 0 && (
        <div className="p-3 border-t border-border/50 bg-muted/10">
          <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1">
            <Paperclip className="w-3 h-3" /> Attached Images ({images.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {images.map((img, idx) => (
              <div key={idx} className="relative group rounded-md border border-border overflow-hidden bg-background">
                <img
                  src={img}
                  alt={`Attached ${idx + 1}`}
                  title="Click to enlarge"
                  onClick={() => setPreviewUrl(img)}
                  className="w-16 h-16 object-cover cursor-zoom-in hover:opacity-90"
                />
                <button
                  type="button"
                  onClick={() => removeImage(idx)}
                  className="absolute top-0.5 right-0.5 bg-background/80 hover:bg-destructive text-foreground hover:text-destructive-foreground p-0.5 rounded-full transition-colors opacity-80 group-hover:opacity-100"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <ImagePreviewModal
        open={!!previewUrl}
        onOpenChange={(o) => !o && setPreviewUrl(null)}
        url={previewUrl}
      />

      {/* Link Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-primary" /> Insert Hyperlink
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Link URL
              </label>
              <Input
                placeholder="https://example.com"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                className="h-8 text-xs bg-input/40 border-border"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Link Text (Optional)
              </label>
              <Input
                placeholder="Display text"
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                className="h-8 text-xs bg-input/40 border-border"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleInsertLink} disabled={!linkUrl.trim()}>
              Insert Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Dialog */}
      <Dialog open={imageDialogOpen} onOpenChange={setImageDialogOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-primary" /> Add Image
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Button
                type="button"
                variant="outline"
                className="w-full h-16 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground"
                onClick={() => {
                  setImageDialogOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <Plus className="w-4 h-4 text-primary" />
                Upload Image File from Computer
              </Button>
            </div>

            <div className="relative flex items-center justify-center my-2">
              <div className="border-t border-border w-full" />
              <span className="bg-card px-2 text-[10px] uppercase font-mono text-muted-foreground absolute">
                OR
              </span>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Image Web URL
              </label>
              <Input
                placeholder="https://images.unsplash.com/..."
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="h-8 text-xs bg-input/40 border-border"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setImageDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAddImageFromUrl} disabled={!imageUrl.trim()}>
              Add Image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

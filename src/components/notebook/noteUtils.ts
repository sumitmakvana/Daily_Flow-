import { toast } from "sonner";

export interface NoteItem {
  id: string;
  title: string;
  content: string; // HTML or text
  tags: string[];
  color: "slate" | "indigo" | "emerald" | "amber" | "rose" | "cyan" | "purple";
  isPinned: boolean;
  images?: string[];
  createdAt: string;
  updatedAt: string;
  authorName?: string;
}

export const COLOR_MAP: Record<NoteItem["color"], { bg: string; border: string; accent: string }> = {
  slate: {
    bg: "bg-card hover:bg-accent/20",
    border: "border-border/70",
    accent: "bg-slate-500",
  },
  indigo: {
    bg: "bg-indigo-950/25 hover:bg-indigo-950/35",
    border: "border-indigo-500/35",
    accent: "bg-indigo-500",
  },
  emerald: {
    bg: "bg-emerald-950/25 hover:bg-emerald-950/35",
    border: "border-emerald-500/35",
    accent: "bg-emerald-500",
  },
  amber: {
    bg: "bg-amber-950/25 hover:bg-amber-950/35",
    border: "border-amber-500/35",
    accent: "bg-amber-500",
  },
  rose: {
    bg: "bg-rose-950/25 hover:bg-rose-950/35",
    border: "border-rose-500/35",
    accent: "bg-rose-500",
  },
  cyan: {
    bg: "bg-cyan-950/25 hover:bg-cyan-950/35",
    border: "border-cyan-500/35",
    accent: "bg-cyan-500",
  },
  purple: {
    bg: "bg-purple-950/25 hover:bg-purple-950/35",
    border: "border-purple-500/35",
    accent: "bg-purple-500",
  },
};

export const NOTE_COLORS = Object.keys(COLOR_MAP) as Array<NoteItem["color"]>;

export function htmlToPlainText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.innerText || div.textContent || "";
}

export function todayNoteTitle(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function copyNoteText(title: string, html: string) {
  navigator.clipboard.writeText(`${title}\n\n${htmlToPlainText(html)}`);
  toast.success("Note copied to clipboard");
}

export function downloadNoteAsText(note: Pick<NoteItem, "title" | "content" | "updatedAt">) {
  const plainText = `# ${note.title || "Untitled Note"}\nDate: ${new Date(note.updatedAt).toLocaleString()}\n\n${htmlToPlainText(note.content)}`;
  const blob = new Blob([plainText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(note.title || "note").toLowerCase().replace(/[^a-z0-9]/g, "_")}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Note exported as file");
}

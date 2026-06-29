import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Upload, Trash2, Download, FileText, Image as ImageIcon, FileSpreadsheet, Music } from "lucide-react";
import { attachmentsService, isAllowedMime } from "@/services/attachments";
import type { Attachment } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { toast } from "sonner";

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("audio/")) return Music;
  if (mime.includes("sheet") || mime === "text/csv") return FileSpreadsheet;
  return FileText;
}

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsPanel({
  workItemId,
  userId,
  canDeleteAny,
}: {
  workItemId: string;
  userId: string;
  /** Manager/admin — can delete any file. Otherwise only own uploads. */
  canDeleteAny: boolean;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await attachmentsService.list(workItemId));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [workItemId]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        if (!isAllowedMime(f.type || "")) {
          toast.error(`Skipped ${f.name}: unsupported type`);
          continue;
        }
        await attachmentsService.upload(workItemId, f, userId);
      }
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const download = async (a: Attachment) => {
    try {
      const url = await attachmentsService.download(a);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (a: Attachment) => {
    try {
      await attachmentsService.remove(a);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" /> Attachments ({items.length})
        </div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload className="h-3.5 w-3.5 mr-1" /> {busy ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,text/*,audio/*"
          onChange={(e) => upload(e.target.files)}
        />
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No files attached.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((a) => {
            const Icon = iconFor(a.file_type);
            const canDelete = canDeleteAny || a.uploaded_by === userId;
            return (
              <li key={a.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{a.file_name}</div>
                  <div className="text-muted-foreground">
                    {humanSize(a.file_size)} · {formatRelative(a.uploaded_at)}
                  </div>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => download(a)} title="Download">
                  <Download className="h-3.5 w-3.5" />
                </Button>
                {canDelete && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    onClick={() => remove(a)}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

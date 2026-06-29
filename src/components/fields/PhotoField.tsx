import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, X, CloudOff } from "lucide-react";
import { attachmentsService } from "@/services/attachments";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { compressImage } from "@/lib/image-compress";
import { offlineQueue } from "@/lib/offline-queue";

export type PhotoValue = { attachment_id?: string; queued_id?: string; captured_at: string; preview_url?: string };

/**
 * Field-grade photo capture.
 *
 * Phase E3 hardening:
 *  - Client-side compression (max 1600px / JPEG q=0.78) before upload.
 *  - Offline-aware: if offline (or upload fails), enqueues to IndexedDB
 *    via offlineQueue and shows a "Will upload when online" hint.
 *  - Local preview is rendered immediately from the captured blob — no
 *    server round-trip needed.
 */
export function PhotoField({
  value, onChange, workItemId, capture = true,
}: {
  value: PhotoValue | null;
  onChange: (v: PhotoValue | null) => void;
  workItemId: string | null;
  capture?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(value?.preview_url ?? null);

  useEffect(() => {
    if (value?.preview_url) { setPreviewUrl(value.preview_url); return; }
    let cancelled = false;
    (async () => {
      if (!value?.attachment_id) { setPreviewUrl(null); return; }
      const { data } = await supabase.from("attachments").select("*").eq("id", value.attachment_id).maybeSingle();
      if (!cancelled && data) {
        try {
          const url = await attachmentsService.download(data as never);
          if (!cancelled) setPreviewUrl(url);
        } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
  }, [value?.attachment_id, value?.preview_url]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!workItemId) { toast.error("Save the item first, then capture the photo."); return; }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in required");

      // 1) Compress locally so the upload (or queued blob) is small.
      const blob = await compressImage(file, { maxEdge: 1600, quality: 0.78 });
      const localPreview = URL.createObjectURL(blob);
      setPreviewUrl(localPreview);

      // 2) Try direct upload when online; on any failure or while offline,
      //    fall back to the durable offline queue.
      if (offlineQueue.isOnline()) {
        try {
          const f = new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
          const att = await attachmentsService.upload(workItemId, f, auth.user.id);
          onChange({ attachment_id: att.id, captured_at: new Date().toISOString(), preview_url: localPreview });
          toast.success("Photo uploaded");
          return;
        } catch {
          // Fall through to offline enqueue.
        }
      }
      const op = await offlineQueue.enqueue({
        kind: "photo.upload",
        payload: {},
        blob,
        blobName: file.name,
        blobType: "image/jpeg",
        workItemId,
        userId: auth.user.id,
      });
      onChange({ queued_id: op.id, captured_at: new Date().toISOString(), preview_url: localPreview });
      toast.info("Saved offline — will upload when online");
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <input
        ref={ref} type="file" accept="image/*"
        {...(capture ? { capture: "environment" as const } : {})}
        className="hidden" onChange={onPick}
      />
      {previewUrl ? (
        <div className="relative inline-block">
          <img src={previewUrl} alt="" className="h-32 rounded-md border border-border" />
          {value?.queued_id && (
            <span className="absolute bottom-1 left-1 flex items-center gap-1 text-[10px] bg-amber-50 text-amber-800 dark:bg-amber-900/60 dark:text-amber-100 px-1.5 py-0.5 rounded">
              <CloudOff className="h-2.5 w-2.5" /> Queued
            </span>
          )}
          <Button type="button" size="sm" variant="secondary" className="absolute top-1 right-1 h-6 w-6 p-0" onClick={() => onChange(null)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" disabled={busy || !workItemId} onClick={() => ref.current?.click()} className="min-h-9">
          {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Camera className="h-3 w-3 mr-1" />}
          {capture ? "Take photo" : "Upload photo"}
        </Button>
      )}
      {!workItemId && <p className="text-[10px] text-muted-foreground">Save the work item first to capture a photo.</p>}
    </div>
  );
}

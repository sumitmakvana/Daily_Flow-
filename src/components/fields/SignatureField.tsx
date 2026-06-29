import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Pen, Trash2, Loader2 } from "lucide-react";
import { attachmentsService } from "@/services/attachments";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { PhotoValue } from "./PhotoField";

export function SignatureField({
  value, onChange, workItemId,
}: {
  value: PhotoValue | null;
  onChange: (v: PhotoValue | null) => void;
  workItemId: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
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
  }, [value?.attachment_id]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, [previewUrl]);

  const pos = (e: PointerEvent | React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e as PointerEvent).clientX - r.left) * (c.width / r.width), y: ((e as PointerEvent).clientY - r.top) * (c.height / r.height) };
  };
  const start = (e: React.PointerEvent) => { drawing.current = true; const p = pos(e); const ctx = canvasRef.current!.getContext("2d")!; ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move  = (e: React.PointerEvent) => { if (!drawing.current) return; const p = pos(e); const ctx = canvasRef.current!.getContext("2d")!; ctx.lineTo(p.x, p.y); ctx.stroke(); dirty.current = true; };
  const end   = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current!; const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); dirty.current = false; };

  const save = async () => {
    if (!workItemId) { toast.error("Save the item first, then sign."); return; }
    if (!dirty.current) { toast.error("Sign in the box first"); return; }
    setBusy(true);
    try {
      const c = canvasRef.current!;
      const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error("canvas error")), "image/png"));
      const file = new File([blob], `signature-${Date.now()}.png`, { type: "image/png" });
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in required");
      const att = await attachmentsService.upload(workItemId, file, auth.user.id);
      onChange({ attachment_id: att.id, captured_at: new Date().toISOString() });
      toast.success("Signature saved");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  if (previewUrl) {
    return (
      <div className="space-y-1">
        <img src={previewUrl} alt="signature" className="h-20 rounded-md border border-border bg-white" />
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}><Trash2 className="h-3 w-3 mr-1" />Clear</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef} width={400} height={120}
        className="w-full max-w-sm rounded-md border border-input bg-white touch-none cursor-crosshair"
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
      />
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={clear}><Trash2 className="h-3 w-3 mr-1" />Clear</Button>
        <Button type="button" size="sm" onClick={save} disabled={busy || !workItemId}>
          {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Pen className="h-3 w-3 mr-1" />}Save signature
        </Button>
      </div>
      {!workItemId && <p className="text-[10px] text-muted-foreground">Save the work item first to capture a signature.</p>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { configSnapshotsService, type ConfigSnapshot } from "@/services/config-snapshots";
import { toast } from "sonner";
import { Camera, Download, RotateCcw, Trash2, Loader2 } from "lucide-react";

const KIND_LABEL: Record<ConfigSnapshot["kind"], string> = {
  manual: "Manual",
  pre_install: "Pre-install",
  pre_import: "Pre-import",
  pre_restore: "Pre-restore",
};
const KIND_VARIANT: Record<ConfigSnapshot["kind"], "default" | "secondary" | "outline"> = {
  manual: "default", pre_install: "secondary", pre_import: "secondary", pre_restore: "outline",
};

export function VersionsPanel() {
  const [snaps, setSnaps] = useState<ConfigSnapshot[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try { setSnaps(await configSnapshotsService.list()); }
    catch (e) { toast.error((e as Error).message); }
  };
  useEffect(() => { load(); }, []);

  const snapshot = async () => {
    if (!label.trim()) return toast.error("Label required");
    setBusy("snap");
    try { await configSnapshotsService.snapshot(label.trim()); toast.success("Snapshot saved"); setLabel(""); load(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  const restore = async (s: ConfigSnapshot) => {
    setBusy(s.id);
    try { await configSnapshotsService.restore(s.id); toast.success("Configuration restored"); load(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  const remove = async (s: ConfigSnapshot) => {
    setBusy(s.id);
    try { await configSnapshotsService.delete(s.id); toast.success("Deleted"); load(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h2 className="text-base font-semibold">Configuration Versions</h2>
        <p className="text-xs text-muted-foreground">
          Snapshots capture your full configuration (types, workflows, fields, approvals, roles). Restore reverts to a past snapshot — your work items stay intact. A snapshot is taken automatically before each template install and import.
        </p>
      </div>

      <div className="flex gap-2">
        <Input placeholder="Snapshot label (e.g. 'Before Pharma migration')" value={label} onChange={(e) => setLabel(e.target.value)} className="h-9 text-sm" />
        <Button size="sm" onClick={snapshot} disabled={busy === "snap"}>
          {busy === "snap" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Camera className="h-3 w-3 mr-1" />}
          Take snapshot
        </Button>
      </div>

      <div className="space-y-1">
        {snaps.map((s) => (
          <div key={s.id} className="flex items-center gap-2 border-b border-border/40 py-2 last:border-0">
            <Badge variant={KIND_VARIANT[s.kind]} className="text-[10px]">{KIND_LABEL[s.kind]}</Badge>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{s.label}</div>
              <div className="text-[10px] text-muted-foreground">{new Date(s.created_at).toLocaleString()}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => configSnapshotsService.download(s)} title="Download JSON">
              <Download className="h-3 w-3" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={busy === s.id} title="Restore">
                  <RotateCcw className="h-3 w-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Restore this snapshot?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will upsert your configuration to match "{s.label}". A safety snapshot will be taken first. Work items are not affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => restore(s)}>Restore</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button variant="ghost" size="sm" disabled={busy === s.id} onClick={() => remove(s)} title="Delete">
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
        {snaps.length === 0 && <p className="text-xs text-muted-foreground py-6 text-center">No snapshots yet.</p>}
      </div>
    </Card>
  );
}

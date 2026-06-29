import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { configIoService, type ConfigPayload, type ImportDiff } from "@/services/config-io";
import { toast } from "sonner";
import { Download, Upload, Loader2, FileJson } from "lucide-react";

export function ImportExportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<ConfigPayload | null>(null);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  const [pendingName, setPendingName] = useState("");

  const onExport = async () => {
    setBusy(true);
    try { await configIoService.exportConfig(); toast.success("Config exported"); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const payload = await configIoService.importFromFile(file);
      const d = await configIoService.previewImport(payload);
      setPendingPayload(payload);
      setDiff(d);
      setPendingName(file.name);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const confirmImport = async () => {
    if (!pendingPayload) return;
    setBusy(true);
    try {
      await configIoService.importConfig(pendingPayload);
      toast.success("Configuration imported");
      setPendingPayload(null); setDiff(null);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Card className="p-4 space-y-4">
      <div>
        <h2 className="text-base font-semibold">Export / Import</h2>
        <p className="text-xs text-muted-foreground">
          Export your full configuration as a JSON file (for backup, version control, or migrating to another tenant). Import to apply a saved configuration — a safety snapshot is taken automatically before any import.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onExport} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Export configuration
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
               onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4 mr-2" />
          Import configuration
        </Button>
      </div>

      <AlertDialog open={!!pendingPayload} onOpenChange={(o) => { if (!o) { setPendingPayload(null); setDiff(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><FileJson className="h-4 w-4" />Import preview</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div className="text-muted-foreground">File: <code className="text-xs">{pendingName}</code></div>
                {diff && (
                  <ul className="text-xs space-y-1">
                    <li>• Work item types: <strong>{diff.types.added}</strong> new, <strong>{diff.types.updated}</strong> updated</li>
                    <li>• Statuses: <strong>{diff.statuses.added}</strong> upserted</li>
                    <li>• Fields: <strong>{diff.fields.added}</strong> upserted</li>
                    <li>• Roles: <strong>{diff.roles.added}</strong> new, <strong>{diff.roles.updated}</strong> updated</li>
                  </ul>
                )}
                <p className="text-xs text-amber-600">A safety snapshot will be taken before applying.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmImport}>Apply import</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

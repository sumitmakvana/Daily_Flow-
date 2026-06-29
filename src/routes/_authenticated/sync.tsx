import { createFileRoute } from "@tanstack/react-router";
import { useOnlineSync } from "@/hooks/use-online-sync";
import { offlineQueue } from "@/lib/offline-queue";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cloud, CloudOff, RefreshCw, Trash2, RotateCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sync")({
  component: SyncCenterPage,
});

function formatAgo(ts: number | null | undefined): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

function kindLabel(kind: string): string {
  return {
    "task.create": "New work item",
    "task.update": "Status / field update",
    "comment.add": "Comment",
    "photo.upload": "Photo upload",
    "form.submit": "Form submission",
  }[kind] ?? kind;
}

function SyncCenterPage() {
  const { online, syncing, ops, pending, failed, lastSync, sync } = useOnlineSync();

  const pendingOps = ops.filter((o) => o.status !== "failed");
  const failedOps = ops.filter((o) => o.status === "failed");

  return (
    <div className="max-w-2xl mx-auto px-3 md:px-4 py-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            {online ? <Cloud className="h-5 w-5 text-emerald-600" /> : <CloudOff className="h-5 w-5 text-amber-600" />}
            Sync Center
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {online ? "Online" : "Offline — changes are queued"} · Last sync {formatAgo(lastSync)}
          </p>
        </div>
        <Button size="sm" disabled={!online || syncing} onClick={sync} className="h-9 min-w-[96px]">
          {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Sync now
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3">
          <div className="text-[11px] text-muted-foreground">Pending</div>
          <div className="text-2xl font-semibold">{pending}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] text-muted-foreground">Failed</div>
          <div className="text-2xl font-semibold text-red-600">{failed}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[11px] text-muted-foreground">Connectivity</div>
          <div className={"text-sm font-semibold " + (online ? "text-emerald-600" : "text-amber-600")}>
            {online ? "Online" : "Offline"}
          </div>
        </Card>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Pending sync ({pendingOps.length})</h2>
        {pendingOps.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Nothing waiting. All caught up.</p>
        ) : (
          pendingOps.map((op) => (
            <Card key={op.id} className="p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{kindLabel(op.kind)}</div>
                <div className="text-[11px] text-muted-foreground">
                  Queued {formatAgo(op.createdAt)} · {op.attempts} attempt{op.attempts === 1 ? "" : "s"}
                </div>
              </div>
              <Badge variant={op.status === "syncing" ? "default" : "secondary"} className="text-[10px]">
                {op.status}
              </Badge>
            </Card>
          ))
        )}
      </section>

      {failedOps.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-red-700">Failed ({failedOps.length})</h2>
            <Button
              variant="ghost" size="sm" className="h-7 text-xs"
              onClick={async () => {
                const n = await offlineQueue.clearFailed();
                toast.success(`Cleared ${n} failed item${n === 1 ? "" : "s"}`);
              }}
            >
              <Trash2 className="h-3 w-3 mr-1" /> Clear all
            </Button>
          </div>
          {failedOps.map((op) => (
            <Card key={op.id} className="p-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{kindLabel(op.kind)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Queued {formatAgo(op.createdAt)} · {op.attempts} attempts
                  </div>
                </div>
                <Button
                  size="sm" variant="outline" className="h-8 min-w-[88px]"
                  onClick={() => offlineQueue.retry(op.id)}
                >
                  <RotateCw className="h-3 w-3 mr-1" /> Retry
                </Button>
              </div>
              {op.lastError && (
                <p className="mt-2 text-[11px] text-red-600 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1 break-words">
                  {op.lastError}
                </p>
              )}
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}

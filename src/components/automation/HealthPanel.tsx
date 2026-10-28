import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { onRealtime, onRealtimeResync, onRealtimeSafetyRefresh } from "@/integrations/realtime/socket";
import { automationsService, type AutomationHealth } from "@/services/automations";

const SOFT_CAP = 5000;
const HARD_CAP = 50000;

export function HealthPanel() {
  const [h, setH] = useState<AutomationHealth | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => automationsService.health().then((d) => alive && setH(d)).catch(() => {});
    load();
    // Pushed by the server (`automation:health`); the shared socket is owned by the app shell.
    // After a reconnect / long tab absence the server says which tables changed, so refetch only if
    // automation_health did (or when it asks for everything). While the socket stays down, the one
    // shared backed-off safety refresh covers us.
    const offEvent = onRealtime("automation:health", load);
    const offResync = onRealtimeResync((info) => {
      if (info.full || info.tables.includes("automation_health")) load();
    });
    const offSafety = onRealtimeSafetyRefresh(load);
    return () => { alive = false; offEvent(); offResync(); offSafety(); };
  }, []);

  if (!h) return <Card className="p-4 text-xs text-muted-foreground">Loading…</Card>;

  const queueState =
    h.pending_count >= HARD_CAP ? "critical" :
    h.pending_count >= SOFT_CAP ? "warning" : "ok";

  return (
    <div className="space-y-3">
      {queueState !== "ok" && (
        <Alert variant={queueState === "critical" ? "destructive" : "default"}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Queue depth {h.pending_count.toLocaleString()} {queueState === "critical"
              ? "— hard cap reached, low-priority events are being dropped"
              : "— above soft cap, watch worker throughput"}
          </AlertDescription>
        </Alert>
      )}
      {h.auto_disabled_rules > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {h.auto_disabled_rules} rule{h.auto_disabled_rules === 1 ? "" : "s"} auto-disabled by the circuit breaker. Review the Rules tab.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric label="Queue depth" value={h.pending_count.toLocaleString()} />
        <Metric label="Runs (24h)" value={h.runs_24h.toLocaleString()} />
        <Metric label="Failed (24h)" value={h.failed_24h.toLocaleString()} tone={h.failed_24h > 0 ? "warn" : "ok"} />
        <Metric label="Dead (24h)" value={h.dead_24h.toLocaleString()} tone={h.dead_24h > 0 ? "bad" : "ok"} />
        <Metric label="Active rules" value={String(h.active_rules)} />
        <Metric label="Auto-disabled" value={String(h.auto_disabled_rules)} tone={h.auto_disabled_rules > 0 ? "warn" : "ok"} />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Soft cap {SOFT_CAP.toLocaleString()}, hard cap {HARD_CAP.toLocaleString()}. Queue counter last updated{" "}
        {new Date(h.pending_updated_at).toLocaleTimeString()}.
      </p>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600" : "";
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
    </Card>
  );
}

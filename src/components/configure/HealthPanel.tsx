import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { configHealthService, type TypeHealth } from "@/services/config-health";
import { ConfigHealthBadge } from "./ConfigHealthBadge";
import { RefreshCw, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function HealthPanel({ onNavigate }: { onNavigate?: (panel: string) => void }) {
  const [items, setItems] = useState<TypeHealth[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setItems(await configHealthService.forAllTypes()); }
    catch (e) { toast.error((e as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const overall = {
    ready: items.filter((i) => i.status === "ok").length,
    warning: items.filter((i) => i.status === "warning").length,
    error: items.filter((i) => i.status === "error").length,
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Configuration Health</h2>
          <p className="text-xs text-muted-foreground">Per-type readiness checks and recommendations.</p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <SummaryTile icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} label="Ready" n={overall.ready} />
        <SummaryTile icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} label="Warnings" n={overall.warning} />
        <SummaryTile icon={<AlertCircle className="h-4 w-4 text-destructive" />} label="Blocked" n={overall.error} />
      </div>

      <div className="space-y-3">
        {items.map((h) => (
          <div key={h.type.id} className="rounded-md border border-border/60 p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: h.type.color ?? "#94a3b8" }} />
                <span className="text-sm font-medium">{h.type.name}</span>
                <ConfigHealthBadge status={h.status} />
              </div>
              <div className="text-[10px] text-muted-foreground">
                {h.counts.statuses} status · {h.counts.transitions} transition · {h.counts.fields} field · {h.counts.chains} chain
              </div>
            </div>
            {h.findings.length === 0 ? (
              <p className="text-xs text-emerald-600">All checks pass.</p>
            ) : (
              <ul className="space-y-1">
                {h.findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    {f.level === "error" ? <AlertCircle className="h-3 w-3 text-destructive mt-0.5" /> :
                     f.level === "warning" ? <AlertTriangle className="h-3 w-3 text-amber-600 mt-0.5" /> :
                     <CheckCircle2 className="h-3 w-3 text-emerald-600 mt-0.5" />}
                    <div className="flex-1">
                      <div>{f.message}</div>
                      {f.hint && <div className="text-muted-foreground">{f.hint}</div>}
                    </div>
                    {f.panel && onNavigate && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onNavigate(f.panel!)}>Fix</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {items.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground py-6 text-center">No types defined yet.</p>
        )}
      </div>
    </Card>
  );
}

function SummaryTile({ icon, label, n }: { icon: React.ReactNode; label: string; n: number }) {
  return (
    <div className="rounded-md border border-border/60 p-2 flex items-center gap-2">
      {icon}
      <div className="flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold">{n}</div>
      </div>
    </div>
  );
}

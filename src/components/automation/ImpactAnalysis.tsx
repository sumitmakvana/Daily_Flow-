import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { analyzeImpact, type ImpactInput, type ImpactReport } from "@/lib/automation/impact";

export function ImpactAnalysis({ input }: { input: ImpactInput }) {
  const [report, setReport] = useState<ImpactReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (input.actions.length === 0) { setReport(null); return; }
    setLoading(true);
    const t = setTimeout(() => {
      analyzeImpact(input)
        .then((r) => { if (!cancelled) setReport(r); })
        .catch(() => { if (!cancelled) setReport(null); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(input)]);

  if (input.actions.length === 0) {
    return <p className="text-xs text-muted-foreground">Add an action to see impact analysis.</p>;
  }
  if (loading && !report) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />Analyzing…
      </div>
    );
  }
  if (!report) return null;

  return (
    <Card className="p-3 space-y-2 bg-muted/30">
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Matching now" value={report.matching_items?.toLocaleString() ?? "—"} />
        <Stat label="Type total" value={report.total_items_of_type?.toLocaleString() ?? "—"} />
        <Stat label="Side-effects / firing" value={String(report.fan_out_per_firing)} />
      </div>
      {report.config_gaps.length > 0 ? (
        <div className="space-y-1">
          {report.config_gaps.map((g, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                <Badge variant="outline" className="text-[10px] mr-1">{g.kind}</Badge>
                {g.message}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="h-3 w-3" />All referenced config exists.
        </div>
      )}
      {report.warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 text-xs text-amber-600">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{w}</span>
        </div>
      ))}
      {report.matching_items != null && report.matching_items === 0 && report.config_gaps.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No items currently match. The rule will fire on future events that meet the criteria.
        </p>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background rounded border border-border/40 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

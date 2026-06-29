import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { predictionsService, riskTone } from "@/services/predictions";
import type { PredictedRisk, Task } from "@/lib/types";
import { AlertTriangle } from "lucide-react";

export function TomorrowRiskPanel({ tasks }: { tasks: Task[] }) {
  const [risks, setRisks] = useState<PredictedRisk[]>([]);
  useEffect(() => { predictionsService.tomorrow().then(setRisks).catch(() => undefined); }, []);

  const byTask = new Map(tasks.map((t) => [t.id, t]));
  const top = risks.slice(0, 8);
  return (
    <Card className="p-3">
      <h2 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <AlertTriangle className="h-4 w-4 text-priority-medium" /> Tomorrow's risk forecast
      </h2>
      {top.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-3 text-center">Nothing risky predicted.</p>
      ) : (
        <ul className="divide-y divide-border">
          {top.map((r) => {
            const t = byTask.get(r.task_id);
            const tone = riskTone(r.risk_score);
            return (
              <li key={r.task_id} className="py-2 flex items-center gap-2">
                <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${tone.className}`}>{r.risk_score}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate font-medium">{t?.task_name ?? r.task_id.slice(0, 8)}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{r.reasons.join(" · ")}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

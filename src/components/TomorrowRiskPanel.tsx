import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { predictionsService, riskTone } from "@/services/predictions";
import { supabase } from "@/integrations/supabase/client";
import type { PredictedRisk, Task } from "@/lib/types";
import { AlertTriangle } from "lucide-react";

const TOP_RISKS = 8;

/**
 * The panel shows only the top few risks, so it reads the names of just those tasks itself
 * instead of every page handing it the whole task list. `tasks` is optional: names it already
 * has are used and only the missing ones are fetched.
 */
export function TomorrowRiskPanel({ tasks = [] }: { tasks?: Array<Pick<Task, "id" | "task_name">> }) {
  const [risks, setRisks] = useState<PredictedRisk[]>([]);
  const [fetched, setFetched] = useState<Map<string, string>>(new Map());
  useEffect(() => { predictionsService.tomorrow().then(setRisks).catch(() => undefined); }, []);

  const top = risks.slice(0, TOP_RISKS);
  const topKey = top.map((r) => r.task_id).join(",");
  const known = new Set(tasks.map((t) => t.id));
  const missingKey = top.filter((r) => !known.has(r.task_id)).map((r) => r.task_id).join(",");
  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    supabase
      .from("tasks")
      .select("id,task_name")
      .in("id", missingKey.split(","))
      .then(({ data }) => {
        if (!cancelled) setFetched(new Map((data ?? []).map((t) => [t.id as string, t.task_name as string])));
      });
    return () => { cancelled = true; };
  }, [missingKey, topKey]);

  const byTask = new Map<string, string>([...fetched, ...tasks.map((t) => [t.id, t.task_name] as [string, string])]);
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
            const name = byTask.get(r.task_id);
            const tone = riskTone(r.risk_score);
            return (
              <li key={r.task_id} className="py-2 flex items-center gap-2">
                <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${tone.className}`}>{r.risk_score}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate font-medium">{name ?? r.task_id.slice(0, 8)}</div>
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

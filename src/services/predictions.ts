import { fetchTomorrowRisks } from "./predictions.functions";
import type { PredictedRisk } from "@/lib/types";

export const predictionsService = {
  async tomorrow(): Promise<PredictedRisk[]> {
    const rows = await fetchTomorrowRisks();
    return rows
      .filter((r) => r.risk_score > 0)
      .sort((a, b) => b.risk_score - a.risk_score);
  },
};

export function riskTone(score: number) {
  if (score >= 60) return { label: "Critical", className: "bg-priority-high/20 text-priority-high border-priority-high/40" };
  if (score >= 35) return { label: "High", className: "bg-priority-high/10 text-priority-high border-priority-high/30" };
  if (score >= 15) return { label: "Medium", className: "bg-priority-medium/15 text-priority-medium border-priority-medium/30" };
  return { label: "Low", className: "bg-muted text-muted-foreground border-border" };
}

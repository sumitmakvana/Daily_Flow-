import { AlertTriangle } from "lucide-react";
import { riskTone } from "@/services/predictions";

export function PredictiveBadge({ score, reasons }: { score: number; reasons: string[] }) {
  if (!score) return null;
  const tone = riskTone(score);
  return (
    <span
      title={`Predicted: ${reasons.join(" · ")}`}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${tone.className}`}
    >
      <AlertTriangle className="h-3 w-3" /> {tone.label} risk
    </span>
  );
}

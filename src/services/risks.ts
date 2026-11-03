import type { RiskSeverity } from "@/lib/types"; // RiskEvent was only used by the commented risksService
// DISABLED: used only by the /command page (disabled). Restore together with it.
// import { listOpenRisksFn, resolveRiskFn } from "./risks.functions";

export const SEVERITY_RANK: Record<RiskSeverity, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

export const SEVERITY_TONE: Record<RiskSeverity, string> = {
  critical: "bg-priority-high/15 text-priority-high border-priority-high/40",
  high: "bg-priority-high/10 text-priority-high border-priority-high/30",
  medium: "bg-priority-medium/15 text-priority-medium border-priority-medium/30",
  low: "bg-muted text-muted-foreground border-border",
};

export const KIND_LABEL: Record<string, string> = {
  task_repeated_delay: "Repeated delay",
  long_blocker: "Long blocker",
  user_overload: "Overloaded",
  high_priority_stagnation: "High-pri stagnant",
  reviewer_bottleneck: "Reviewer bottleneck",
  workload_spike: "Workload spike",
};

// DISABLED: used only by the /command page (disabled). Restore together with it. risksService (the cron hook /api/public/hooks/detect-risks is shared and untouched)
// export const risksService = {
//   async listOpen(): Promise<RiskEvent[]> {
//     return (await listOpenRisksFn()) as RiskEvent[];
//   },
//   async resolve(id: string, _userId: string) {
//     await resolveRiskFn({ data: { id } });
//   },
//   /** Trigger backend detection via cron hook from the UI. */
//   async detectNow() {
//     const res = await fetch("/api/public/hooks/detect-risks", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: "{}",
//     });
//     return res.ok;
//   },
// };

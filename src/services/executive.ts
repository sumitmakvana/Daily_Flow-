// Thin re-export + helpers. All aggregation now happens server-side via
// `getExecSummary` (src/lib/executive.functions.ts). The dashboard no longer
// queries individual tables (P0 fix: removed 13× tasks.select('*')).

export type { ExecSummary } from "@/lib/executive.functions";
export { getExecSummary } from "@/lib/executive.functions";

export function daysBackList(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

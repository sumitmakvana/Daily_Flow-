import { fetchIntelligenceBundle, type IntelligenceBundle } from "./intelligence.functions";
import type { Task } from "@/lib/types";

export type { IntelligenceBundle };

export const intelligenceService = {
  async load(daysBack = 14): Promise<IntelligenceBundle> {
    const since = new Date();
    since.setDate(since.getDate() - daysBack);
    const sinceISO = since.toISOString().slice(0, 10);
    return (await fetchIntelligenceBundle({ data: { sinceISO } })) as unknown as IntelligenceBundle;
  },
};

/** Tokenize blocker reasons for delay root-cause buckets. */
export function blockerRootCauses(tasks: Task[]): { label: string; count: number }[] {
  const buckets: Record<string, number> = {};
  const re = /\b([a-zA-Z]{4,})\b/g;
  const stop = new Set([
    "task","tasks","being","waiting","needs","need","blocker","blocked","with","from","that","this","because","still","cannot",
  ]);
  for (const t of tasks) {
    if (!t.blocker_reason) continue;
    const seen = new Set<string>();
    for (const m of t.blocker_reason.toLowerCase().matchAll(re)) {
      const w = m[1];
      if (stop.has(w) || seen.has(w)) continue;
      seen.add(w);
      buckets[w] = (buckets[w] ?? 0) + 1;
    }
  }
  return Object.entries(buckets)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

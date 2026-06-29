import { fetchAdoptionLast14 } from "./adoption.functions";
import type { AdoptionDaily } from "@/lib/types";

export const adoptionService = {
  async last14(): Promise<AdoptionDaily[]> {
    const since = new Date();
    since.setDate(since.getDate() - 14);
    return fetchAdoptionLast14({ data: { sinceISO: since.toISOString().slice(0, 10) } });
  },
};

export function dauSeries(rows: AdoptionDaily[]) {
  const m = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.status_updates_count > 0 || r.eod_submitted || r.notif_interactions > 0) {
      const s = m.get(r.rollup_date) ?? new Set<string>();
      s.add(r.user_id);
      m.set(r.rollup_date, s);
    }
  }
  return Array.from(m.entries())
    .map(([date, set]) => ({ date, dau: set.size }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

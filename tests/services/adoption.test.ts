import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { adoptionService, dauSeries } from "@/services/adoption";

describe("services/adoption", () => {
  beforeEach(() => mockSupabase.reset());
  it("last14 returns rows", async () => {
    mockSupabase.queueResponse("select", { data: [{ user_id: "u", rollup_date: "2026-05-20" }] });
    expect(await adoptionService.last14()).toHaveLength(1);
  });
  it("last14 returns [] on null", async () => {
    mockSupabase.queueResponse("select", { data: null });
    expect(await adoptionService.last14()).toEqual([]);
  });
});

describe("dauSeries", () => {
  it("returns [] when no active users", () => {
    expect(dauSeries([{ user_id: "u", rollup_date: "2026-05-20", status_updates_count: 0, eod_submitted: false, blocker_usage: false, planning_views: 0, notif_interactions: 0 }])).toEqual([]);
  });
  it("dedupes per day", () => {
    const out = dauSeries([
      { user_id: "u1", rollup_date: "2026-05-20", status_updates_count: 1, eod_submitted: false, blocker_usage: false, planning_views: 0, notif_interactions: 0 },
      { user_id: "u1", rollup_date: "2026-05-20", status_updates_count: 0, eod_submitted: true, blocker_usage: false, planning_views: 0, notif_interactions: 0 },
      { user_id: "u2", rollup_date: "2026-05-20", status_updates_count: 0, eod_submitted: false, blocker_usage: false, planning_views: 0, notif_interactions: 3 },
    ] as never);
    expect(out).toEqual([{ date: "2026-05-20", dau: 2 }]);
  });
});

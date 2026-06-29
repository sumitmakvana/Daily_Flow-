import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { notifPrefsService } from "@/services/notif-prefs";

describe("services/notif-prefs", () => {
  beforeEach(() => mockSupabase.reset());

  it("get returns defaults when no row", async () => {
    mockSupabase.queueResponse("select", { data: null });
    const p = await notifPrefsService.get("u1");
    expect(p.user_id).toBe("u1");
    expect(p.digest_enabled).toBe(true);
    expect(p.eod_reminder_hour).toBe(16);
  });

  it("get returns existing row", async () => {
    mockSupabase.queueResponse("select", { data: { user_id: "u1", digest_enabled: false, eod_reminder_hour: 18, notify_assignment: false, notify_priority_change: true, notify_blocker_resolved: true, notify_manager_overload: true, notify_manager_delays: true } });
    const p = await notifPrefsService.get("u1");
    expect(p.digest_enabled).toBe(false);
    expect(p.eod_reminder_hour).toBe(18);
  });

  it("save returns updated row", async () => {
    mockSupabase.queueResponse("upsert", { data: { user_id: "u1", digest_enabled: true } });
    const p = await notifPrefsService.save({ user_id: "u1" } as never);
    expect(p.user_id).toBe("u1");
  });

  it("save throws on error", async () => {
    mockSupabase.queueResponse("upsert", { error: { message: "x" } });
    await expect(notifPrefsService.save({ user_id: "u1" } as never)).rejects.toBeTruthy();
  });
});

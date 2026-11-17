import { beforeEach, describe, expect, it } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { holidaysService, workSettingsService } from "@/services/operations";
import { takeTickerSettingsStale } from "@/lib/ticker-settings-cache.server";

// Every in-app write to work_settings / holiday_calendar must tell the CronTicker to re-read its cached settings.
describe("admin settings writes mark the CronTicker cache stale", () => {
  beforeEach(() => {
    mockSupabase.reset();
    takeTickerSettingsStale(); // start clean
  });

  it("saving work settings", async () => {
    mockSupabase.queueResponse("update", { data: null });
    await workSettingsService.update({ evening_digest_time: "18:45" });
    expect(takeTickerSettingsStale()).toBe(true);
  });

  it("adding a holiday", async () => {
    mockSupabase.queueResponse("insert", { data: null });
    await holidaysService.add("2026-12-25", "Xmas");
    expect(takeTickerSettingsStale()).toBe(true);
  });

  it("removing a holiday", async () => {
    mockSupabase.queueResponse("delete", { data: null });
    await holidaysService.remove("3f2b8a9e-1c4d-4e5f-8a6b-7c8d9e0f1a2b");
    expect(takeTickerSettingsStale()).toBe(true);
  });

  it("a failed write does not mark it", async () => {
    mockSupabase.queueResponse("insert", { error: { message: "x" } });
    await expect(holidaysService.add("2026-12-25", "Xmas")).rejects.toBeTruthy();
    mockSupabase.queueResponse("update", { error: { message: "x" } });
    await expect(workSettingsService.update({ evening_digest_time: "18:45" })).rejects.toBeTruthy();
    expect(takeTickerSettingsStale()).toBe(false);
  });

  it("the mark is taken once", async () => {
    mockSupabase.queueResponse("insert", { data: null });
    await holidaysService.add("2026-12-25", "Xmas");
    expect(takeTickerSettingsStale()).toBe(true);
    expect(takeTickerSettingsStale()).toBe(false);
  });
});

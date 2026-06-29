import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { eodService } from "@/services/eod";

describe("services/eod", () => {
  beforeEach(() => mockSupabase.reset());

  it("getToday returns row", async () => {
    mockSupabase.queueResponse("select", { data: { id: "e", user_id: "u" } });
    const r = await eodService.getToday("u");
    expect(r?.user_id).toBe("u");
  });
  it("getToday returns null when no row", async () => {
    mockSupabase.queueResponse("select", { data: null });
    expect(await eodService.getToday("u")).toBeNull();
  });

  it("upsert returns row", async () => {
    mockSupabase.queueResponse("upsert", { data: { id: "e" } });
    const r = await eodService.upsert("u", { note: "n" });
    expect(r.id).toBe("e");
  });
  it("upsert throws on error", async () => {
    mockSupabase.queueResponse("upsert", { error: { message: "x" } });
    await expect(eodService.upsert("u", {})).rejects.toBeTruthy();
  });

  it("listForDate returns rows", async () => {
    mockSupabase.queueResponse("select", { data: [{ id: "1" }] });
    expect(await eodService.listForDate("2026-05-20")).toHaveLength(1);
  });
  it("listForDate returns [] when null", async () => {
    mockSupabase.queueResponse("select", { data: null });
    expect(await eodService.listForDate("2026-05-20")).toEqual([]);
  });
});

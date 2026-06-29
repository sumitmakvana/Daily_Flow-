import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { risksService, SEVERITY_RANK, SEVERITY_TONE, KIND_LABEL } from "@/services/risks";

describe("services/risks", () => {
  beforeEach(() => mockSupabase.reset());

  it("SEVERITY_RANK ordering", () => {
    expect(SEVERITY_RANK.critical).toBeGreaterThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeGreaterThan(SEVERITY_RANK.medium);
    expect(SEVERITY_RANK.medium).toBeGreaterThan(SEVERITY_RANK.low);
  });

  it("SEVERITY_TONE has all keys", () => {
    expect(Object.keys(SEVERITY_TONE)).toEqual(expect.arrayContaining(["critical", "high", "medium", "low"]));
  });

  it("KIND_LABEL covers known kinds", () => {
    expect(KIND_LABEL.task_repeated_delay).toBe("Repeated delay");
    expect(KIND_LABEL.long_blocker).toBe("Long blocker");
  });

  it("listOpen returns risks", async () => {
    mockSupabase.queueResponse("select", { data: [{ id: "r1", severity: "high" }] });
    const r = await risksService.listOpen();
    expect(r).toHaveLength(1);
  });

  it("listOpen returns [] on empty", async () => {
    mockSupabase.queueResponse("select", { data: null });
    expect(await risksService.listOpen()).toEqual([]);
  });

  it("listOpen throws on error", async () => {
    mockSupabase.queueResponse("select", { error: { message: "x" } });
    await expect(risksService.listOpen()).rejects.toBeTruthy();
  });

  it("resolve updates row", async () => {
    mockSupabase.queueResponse("update", { data: null });
    await risksService.resolve("r1", "u1");
    expect(mockSupabase.calls.ops[0].op).toBe("update");
  });

  it("resolve throws on error", async () => {
    mockSupabase.queueResponse("update", { error: { message: "x" } });
    await expect(risksService.resolve("r1", "u1")).rejects.toBeTruthy();
  });

  it("detectNow posts to hook", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as never;
    const ok = await risksService.detectNow();
    expect(ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/public/hooks/detect-risks",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("detectNow returns false on non-OK", async () => {
    globalThis.fetch = vi.fn(async () => new Response("err", { status: 500 })) as never;
    expect(await risksService.detectNow()).toBe(false);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { nudgesService } from "@/services/nudges";

describe("services/nudges", () => {
  beforeEach(() => mockSupabase.reset());

  it("listActive returns rows", async () => {
    mockSupabase.queueResponse("select", { data: [{ id: "n1" }] });
    expect(await nudgesService.listActive("u1")).toHaveLength(1);
  });
  it("listActive returns [] on null", async () => {
    mockSupabase.queueResponse("select", { data: null });
    expect(await nudgesService.listActive("u1")).toEqual([]);
  });
  it("listActive throws on error", async () => {
    mockSupabase.queueResponse("select", { error: { message: "x" } });
    await expect(nudgesService.listActive("u1")).rejects.toBeTruthy();
  });

  it("markRead updates", async () => {
    mockSupabase.queueResponse("update", { data: null });
    await nudgesService.markRead("n1");
    expect(mockSupabase.calls.ops[0].op).toBe("update");
  });

  it("dismiss updates", async () => {
    mockSupabase.queueResponse("update", { data: null });
    await nudgesService.dismiss("n1");
    expect(mockSupabase.calls.ops[0].op).toBe("update");
  });

  it("generateNow ok", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200 })) as never;
    expect(await nudgesService.generateNow()).toBe(true);
  });
  it("generateNow false", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 500 })) as never;
    expect(await nudgesService.generateNow()).toBe(false);
  });
});

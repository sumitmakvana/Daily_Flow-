import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { planningSuggestionsService, SUGGESTION_KIND_LABEL } from "@/services/planning-suggestions";

describe("services/planning-suggestions", () => {
  beforeEach(() => mockSupabase.reset());

  it("has labels for known kinds", () => {
    expect(SUGGESTION_KIND_LABEL.reassign).toBeTruthy();
    expect(SUGGESTION_KIND_LABEL.priority).toBeTruthy();
    expect(SUGGESTION_KIND_LABEL.due_date).toBeTruthy();
  });

  it("listOpen returns rows", async () => {
    mockSupabase.queueResponse("select", { data: [{ id: "s1" }] });
    expect(await planningSuggestionsService.listOpen()).toHaveLength(1);
  });

  it("listOpen returns [] on null", async () => {
    mockSupabase.queueResponse("select", { data: null });
    expect(await planningSuggestionsService.listOpen()).toEqual([]);
  });

  it("listOpen throws on error", async () => {
    mockSupabase.queueResponse("select", { error: { message: "x" } });
    await expect(planningSuggestionsService.listOpen()).rejects.toBeTruthy();
  });

  it("resolve updates row", async () => {
    mockSupabase.queueResponse("update", { data: null });
    await planningSuggestionsService.resolve("s1", "accepted", "u1");
    expect((mockSupabase.calls.ops[0].payload as Record<string, string>).status).toBe("accepted");
  });

  it("resolve throws on error", async () => {
    mockSupabase.queueResponse("update", { error: { message: "x" } });
    await expect(planningSuggestionsService.resolve("s1", "dismissed", "u1")).rejects.toBeTruthy();
  });

  it("generateNow returns ok", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as never;
    expect(await planningSuggestionsService.generateNow()).toBe(true);
  });

  it("generateNow returns false on failure", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 500 })) as never;
    expect(await planningSuggestionsService.generateNow()).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { intelligenceService, blockerRootCauses } from "@/services/intelligence";
import type { Task } from "@/lib/types";

describe("services/intelligence.load", () => {
  beforeEach(() => mockSupabase.reset());

  it("loads bundle in parallel", async () => {
    mockSupabase.queueResponse("select", { data: [{ id: "t1" }] });
    mockSupabase.queueResponse("select", { data: [{ id: "r1" }] });
    mockSupabase.queueResponse("select", { data: [{ user_id: "u" }] });
    mockSupabase.queueResponse("select", { data: [{ user_id: "u" }] });
    mockSupabase.queueResponse("select", { data: [{ id: "e1" }] });
    const b = await intelligenceService.load(7);
    expect(b.tasks).toHaveLength(1);
    expect(b.risks).toHaveLength(1);
    expect(b.snapshots).toHaveLength(1);
    expect(b.adoption).toHaveLength(1);
    expect(b.eods).toHaveLength(1);
  });

  it("returns empty when all null", async () => {
    for (let i = 0; i < 5; i++) mockSupabase.queueResponse("select", { data: null });
    const b = await intelligenceService.load();
    expect(b.tasks).toEqual([]);
    expect(b.risks).toEqual([]);
    expect(b.snapshots).toEqual([]);
    expect(b.adoption).toEqual([]);
    expect(b.eods).toEqual([]);
  });
});

describe("blockerRootCauses", () => {
  const t = (reason: string | null): Task => ({
    id: Math.random().toString(), task_code: "T", task_name: "x",
    status: "Blocked", priority: "Medium", version: 1, done: false,
    carry_forward_count: 0, assigned_to: null, reviewer: null, due_date: null,
    blocker_reason: reason, blocked_at: null, planned_hours: 0, actual_hours: 0,
    created_at: "", updated_at: "",
  } as Task);

  it("returns empty for no reasons", () => {
    expect(blockerRootCauses([t(null)])).toEqual([]);
  });

  it("tokenizes and counts", () => {
    const out = blockerRootCauses([
      t("waiting on vendor approval"),
      t("vendor delay"),
      t("design review pending"),
    ]);
    const labels = out.map((x) => x.label);
    expect(labels).toContain("vendor");
  });

  it("dedupes within one task", () => {
    const out = blockerRootCauses([t("vendor vendor vendor")]);
    const vendor = out.find((x) => x.label === "vendor");
    expect(vendor?.count).toBe(1);
  });

  it("skips stop words", () => {
    const out = blockerRootCauses([t("task being blocked because waiting")]);
    expect(out.find((x) => x.label === "blocked")).toBeUndefined();
    expect(out.find((x) => x.label === "task")).toBeUndefined();
  });

  it("caps at top 8", () => {
    const reason = Array.from({length: 20}, (_, i) => `word${String.fromCharCode(97+i)}xxxx`).join(" ");
    const out = blockerRootCauses([t(reason)]);
    expect(out.length).toBeLessThanOrEqual(8);
  });
});

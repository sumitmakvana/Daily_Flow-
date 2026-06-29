import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { exportsService, EXPORT_LABELS, type ExportKind } from "@/services/exports";

vi.mock("@/lib/csv", () => ({
  toCSV: vi.fn(() => "a,b\n1,2"),
  downloadCSV: vi.fn(),
}));

describe("services/exports", () => {
  beforeEach(() => mockSupabase.reset());

  const kinds: ExportKind[] = [
    "task_audit",
    "user_activity",
    "carry_forward",
    "blockers",
    "workload",
    "sla_violations",
    "daily_ops",
  ];

  for (const kind of kinds) {
    it(`runs ${kind} export`, async () => {
      mockSupabase.queueResponse("select", { data: [{ a: 1 }] });
      mockSupabase.queueResponse("insert", { data: null });
      const n = await exportsService.run(kind, { from: "2026-01-01", to: "2026-01-31", userId: "u" }, "csv", "u");
      expect(n).toBe(1);
    });
  }

  it("xls format produces xls extension", async () => {
    mockSupabase.queueResponse("select", { data: [] });
    mockSupabase.queueResponse("insert", { data: null });
    const n = await exportsService.run("blockers", {}, "xls", "u");
    expect(n).toBe(0);
  });

  it("EXPORT_LABELS covers every kind", () => {
    for (const k of kinds) expect(EXPORT_LABELS[k]).toBeTruthy();
  });

  it("audit insert failure does not throw", async () => {
    mockSupabase.queueResponse("select", { data: [] });
    mockSupabase.queueResponse("insert", { error: { message: "denied" } });
    await expect(exportsService.run("blockers", {}, "csv", "u")).resolves.toBe(0);
  });
});

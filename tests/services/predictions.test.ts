import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { predictionsService, riskTone } from "@/services/predictions";

describe("services/predictions", () => {
  beforeEach(() => mockSupabase.reset());

  it("tomorrow filters score 0 and sorts desc", async () => {
    mockSupabase.queueResponse("rpc", { data: [
      { task_id: "a", risk_score: 0, reasons: [] },
      { task_id: "b", risk_score: 40, reasons: ["x"] },
      { task_id: "c", risk_score: 70, reasons: ["y"] },
    ]});
    const out = await predictionsService.tomorrow();
    expect(out.map((r) => r.task_id)).toEqual(["c", "b"]);
  });

  it("tomorrow empty when null", async () => {
    mockSupabase.queueResponse("rpc", { data: null });
    expect(await predictionsService.tomorrow()).toEqual([]);
  });

  it("tomorrow throws on error", async () => {
    mockSupabase.queueResponse("rpc", { error: { message: "x" } });
    await expect(predictionsService.tomorrow()).rejects.toBeTruthy();
  });

  it("riskTone tiers", () => {
    expect(riskTone(70).label).toBe("Critical");
    expect(riskTone(40).label).toBe("High");
    expect(riskTone(20).label).toBe("Medium");
    expect(riskTone(5).label).toBe("Low");
  });
});

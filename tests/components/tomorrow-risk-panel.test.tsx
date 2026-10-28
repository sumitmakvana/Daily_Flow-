import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The panel shows the top 8 risks. It reads those tasks' names itself (one small request) instead of
// every page downloading all tasks for it.

const risks = Array.from({ length: 12 }, (_, i) => ({ task_id: `t${i}`, risk_score: 90 - i, reasons: [`r${i}`] }));
vi.mock("@/services/predictions", () => ({
  predictionsService: { tomorrow: async () => risks },
  riskTone: () => ({ className: "" }),
}));

const inCalls: Array<{ table: string; cols: string; ids: string[] }> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        in: async (_c: string, ids: string[]) => {
          inCalls.push({ table, cols, ids });
          return { data: ids.map((id) => ({ id, task_name: `Name ${id}` })) };
        },
      }),
    }),
  },
}));

import { TomorrowRiskPanel } from "@/components/TomorrowRiskPanel";
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

beforeEach(() => { inCalls.length = 0; });

describe("TomorrowRiskPanel", () => {
  it("fetches names for only the top 8 risks, with just id and task_name", async () => {
    const { findByText, queryByText } = render(<TomorrowRiskPanel />);
    await flush();
    expect(inCalls).toHaveLength(1);
    expect(inCalls[0]).toMatchObject({ table: "tasks", cols: "id,task_name" });
    expect(inCalls[0].ids).toEqual(["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"]);
    expect(await findByText("Name t0")).toBeTruthy();
    expect(queryByText("Name t8")).toBeNull();
  });

  it("does not fetch names it was already given", async () => {
    render(<TomorrowRiskPanel tasks={Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, task_name: `Given ${i}` }))} />);
    await flush();
    expect(inCalls).toHaveLength(0);
  });

  it("falls back to a short id for a task it cannot name", async () => {
    const { findByText } = render(<TomorrowRiskPanel tasks={[]} />);
    await flush();
    expect(await findByText("Name t1")).toBeTruthy();
  });
});

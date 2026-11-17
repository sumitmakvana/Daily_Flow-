import { beforeEach, describe, expect, it, vi } from "vitest";

// A plain function, not vi.fn(): Vitest fails a test when a vi.fn implementation throws, even if the
// code under test catches it, and the "lookup fails" case below needs the query to throw.
type Rows = { rows: Array<{ label: string | null }> };
let impl: (sql: string, params?: unknown[]) => Promise<Rows>;
let calls: Array<[string, unknown[] | undefined]> = [];
const query = (sql: string, params?: unknown[]) => {
  calls.push([sql, params]);
  return impl(sql, params);
};
vi.mock("@/integrations/postgres/client.server", () => ({ getPool: () => ({ query }) }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { workdays: [1, 2, 3, 4, 5] } }) }) }) }),
  },
}));
vi.mock("@/services/leaves.server", () => ({ promoteDueTentativeLeaves: async () => 0 }));

import { checkIsWorkingDayServer } from "@/lib/workday-checker.server";

const WEDNESDAY = "2026-11-18";

describe("checkIsWorkingDayServer company holidays", () => {
  beforeEach(() => {
    calls = [];
    impl = async () => ({ rows: [] });
  });

  it("reads only the target date from holiday_calendar", async () => {
    await checkIsWorkingDayServer(WEDNESDAY);
    expect(calls).toHaveLength(1);
    const [sql, params] = calls[0];
    expect(sql).toContain("public.holiday_calendar");
    expect(sql).not.toMatch(/public\.holidays\b/);
    expect(params).toEqual([WEDNESDAY]);
  });

  it("treats a holiday_calendar date as a company holiday", async () => {
    impl = async () => ({ rows: [{ label: "Office Picnic" }] });
    const r = await checkIsWorkingDayServer(WEDNESDAY);
    expect(r).toMatchObject({ isWorkingDay: false, reason: "company_holiday" });
    expect(r.label).toContain("Office Picnic");
  });

  it("is a working day when the date is not in holiday_calendar", async () => {
    expect(await checkIsWorkingDayServer(WEDNESDAY)).toMatchObject({ isWorkingDay: true, reason: "working_day" });
  });

  it("logs a failed lookup instead of hiding it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    impl = async () => {
      throw new Error('relation "public.holiday_calendar" does not exist');
    };
    expect(await checkIsWorkingDayServer(WEDNESDAY)).toMatchObject({ isWorkingDay: true });
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[workday]"), expect.stringContaining("does not exist"));
    err.mockRestore();
  });

  it("does not query holidays on a non-working weekday", async () => {
    const r = await checkIsWorkingDayServer("2026-11-22"); // Sunday
    expect(r).toMatchObject({ isWorkingDay: false, reason: "weekend" });
    expect(calls).toHaveLength(0);
  });
});

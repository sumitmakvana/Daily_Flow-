import { beforeEach, describe, expect, it, vi } from "vitest";

// A plain function, not vi.fn(): Vitest fails a test when a vi.fn implementation throws, even if the
// code under test catches it, and the "lookup fails" cases below need the query to throw.
type Result = { rows: Array<Record<string, unknown>> };
let settingsImpl: () => Promise<Result>;
let holidayImpl: (params?: unknown[]) => Promise<Result>;
let calls: Array<[string, unknown[] | undefined]> = [];
const query = (sql: string, params?: unknown[]) => {
  calls.push([sql, params]);
  return /work_settings/.test(sql) ? settingsImpl() : holidayImpl(params);
};
vi.mock("@/integrations/postgres/client.server", () => ({ getPool: () => ({ query }) }));
vi.mock("@/services/leaves.server", () => ({ promoteDueTentativeLeaves: async () => 0 }));

import { checkIsWorkingDayServer, readWorkSettingsServer } from "@/lib/workday-checker.server";

const WEDNESDAY = "2026-11-18";
const SUNDAY = "2026-11-22";
const sqlOf = (re: RegExp) => calls.filter(([sql]) => re.test(sql));

describe("readWorkSettingsServer", () => {
  beforeEach(() => {
    calls = [];
    settingsImpl = async () => ({
      rows: [{ workdays: [1, 2, 3, 4, 5], morning_digest_time: "10:30", evening_digest_time: "18:30" }],
    });
  });

  it("reads workdays and both digest times in one query", async () => {
    expect(await readWorkSettingsServer()).toEqual({
      workdays: [1, 2, 3, 4, 5],
      morning_digest_time: "10:30",
      evening_digest_time: "18:30",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatch(/SELECT workdays, morning_digest_time, evening_digest_time FROM public\.work_settings WHERE id = 1/);
  });

  it("returns null when the row is missing", async () => {
    settingsImpl = async () => ({ rows: [] });
    expect(await readWorkSettingsServer()).toBeNull();
  });

  it("logs a failed read and returns null, or throws with throwOnError", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    settingsImpl = async () => {
      throw new Error("connection refused");
    };
    expect(await readWorkSettingsServer()).toBeNull();
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[workday] work_settings read failed"), "connection refused");
    await expect(readWorkSettingsServer({ throwOnError: true })).rejects.toThrow("connection refused");
    err.mockRestore();
  });
});

describe("checkIsWorkingDayServer", () => {
  beforeEach(() => {
    calls = [];
    settingsImpl = async () => ({ rows: [{ workdays: [1, 2, 3, 4, 5] }] });
    holidayImpl = async () => ({ rows: [] });
  });

  it("reads only the target date from holiday_calendar", async () => {
    await checkIsWorkingDayServer(WEDNESDAY);
    const holiday = sqlOf(/holiday/);
    expect(holiday).toHaveLength(1);
    expect(holiday[0][0]).toContain("public.holiday_calendar");
    expect(holiday[0][0]).not.toMatch(/public\.holidays\b/);
    expect(holiday[0][1]).toEqual([WEDNESDAY]);
  });

  it("treats a holiday_calendar date as a company holiday", async () => {
    holidayImpl = async () => ({ rows: [{ label: "Office Picnic" }] });
    const r = await checkIsWorkingDayServer(WEDNESDAY);
    expect(r).toMatchObject({ isWorkingDay: false, reason: "company_holiday" });
    expect(r.label).toContain("Office Picnic");
  });

  it("is a working day when the date is not in holiday_calendar", async () => {
    expect(await checkIsWorkingDayServer(WEDNESDAY)).toMatchObject({ isWorkingDay: true, reason: "working_day" });
  });

  it("logs a failed holiday lookup instead of hiding it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    holidayImpl = async () => {
      throw new Error('relation "public.holiday_calendar" does not exist');
    };
    expect(await checkIsWorkingDayServer(WEDNESDAY)).toMatchObject({ isWorkingDay: true });
    expect(err).toHaveBeenCalledWith(expect.stringContaining("[workday]"), expect.stringContaining("does not exist"));
    err.mockRestore();
  });

  it("does not query holidays on a non-working weekday", async () => {
    expect(await checkIsWorkingDayServer(SUNDAY)).toMatchObject({ isWorkingDay: false, reason: "weekend" });
    expect(sqlOf(/holiday/)).toHaveLength(0);
  });

  it("uses workdays passed by the caller without reading work_settings again", async () => {
    expect(await checkIsWorkingDayServer(WEDNESDAY, [1, 2, 3, 4, 5])).toMatchObject({ isWorkingDay: true });
    expect(sqlOf(/work_settings/)).toHaveLength(0);
    // Wednesday (3) is not a workday in this configuration.
    expect(await checkIsWorkingDayServer(WEDNESDAY, [1, 2])).toMatchObject({ isWorkingDay: false, reason: "weekend" });
  });

  it("falls back to Mon-Fri when work_settings cannot be read", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    settingsImpl = async () => {
      throw new Error("connection refused");
    };
    expect(await checkIsWorkingDayServer(WEDNESDAY)).toMatchObject({ isWorkingDay: true });
    expect(await checkIsWorkingDayServer(SUNDAY)).toMatchObject({ isWorkingDay: false, reason: "weekend" });
    err.mockRestore();
  });

  it("with throwOnError, a failed work_settings or holiday read throws instead of guessing", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    settingsImpl = async () => {
      throw new Error("connection refused");
    };
    await expect(checkIsWorkingDayServer(WEDNESDAY, undefined, { throwOnError: true })).rejects.toThrow("connection refused");

    holidayImpl = async () => {
      throw new Error("statement timeout");
    };
    await expect(checkIsWorkingDayServer(WEDNESDAY, [1, 2, 3, 4, 5], { throwOnError: true })).rejects.toThrow(
      "statement timeout",
    );
    err.mockRestore();
  });

  it("falls back to Mon-Fri when the caller passes null or empty workdays", async () => {
    expect(await checkIsWorkingDayServer(WEDNESDAY, null)).toMatchObject({ isWorkingDay: true });
    expect(await checkIsWorkingDayServer(SUNDAY, [])).toMatchObject({ isWorkingDay: false, reason: "weekend" });
    expect(sqlOf(/work_settings/)).toHaveLength(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Plain functions, not vi.fn(): Vitest fails a test when a vi.fn implementation throws, even if the
// code under test catches it, and these tests need the settings reads to throw.
type Settings = { workdays: number[]; morning_digest_time: string; evening_digest_time: string };
const GOOD: Settings = { workdays: [1, 2, 3, 4, 5], morning_digest_time: "10:30", evening_digest_time: "18:30" };
let current: Settings = { ...GOOD };
let settingsFails = false;
let holidayFails = false;
let holidayToday = false;
let settingsReads = 0;
const evening: string[] = [];

vi.mock("@/lib/workday-checker.server", () => ({
  readWorkSettingsServer: async (opts: { throwOnError?: boolean } = {}) => {
    settingsReads += 1;
    if (settingsFails) {
      if (opts.throwOnError) throw new Error("connection refused");
      return null;
    }
    return { ...current };
  },
  checkIsWorkingDayServer: async (_d: string, _w: unknown, opts: { throwOnError?: boolean } = {}) => {
    if (holidayFails) {
      if (opts.throwOnError) throw new Error("statement timeout");
      return { isWorkingDay: true };
    }
    return { isWorkingDay: !holidayToday };
  },
}));
vi.mock("@/lib/digests/evening-digest.server", () => ({
  runEveningDigest: async () => {
    evening.push(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }));
  },
}));
vi.mock("@/lib/digests/morning-digest.server", () => ({ runMorningDigest: async () => {} }));
vi.mock("@/lib/task-push.server", () => ({ pushOverdueTasks: async () => {} }));
vi.mock("@/services/leaves.server", () => ({ promoteDueTentativeLeaves: async () => 0 }));
vi.mock("@/integrations/postgres/client.server", () => ({ getPool: () => ({ query: async () => ({ rows: [] }) }) }));

import { startBackgroundCronTicker } from "@/lib/cron-ticker.server";
import { markTickerSettingsStale, takeTickerSettingsStale } from "@/lib/ticker-settings-cache.server";

const g = globalThis as unknown as {
  __cronTickerInterval?: NodeJS.Timeout;
  __cronFiredKeys?: Set<string>;
  __tickerSettings?: unknown;
  __lastPromoteDate?: string;
  __lastPromoteAt?: number;
};
const ist = (hhmm: string) => new Date(`2026-11-18T${hhmm}:00+05:30`); // a Wednesday
const minutes = async (n: number) => {
  for (let i = 0; i < n; i++) await vi.advanceTimersByTimeAsync(60_000);
};

describe("CronTicker settings refresh", () => {
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    current = { ...GOOD };
    settingsFails = false;
    holidayFails = false;
    holidayToday = false;
    takeTickerSettingsStale();
    settingsReads = 0;
    evening.length = 0;
    g.__cronFiredKeys?.clear();
    g.__tickerSettings = undefined;
    g.__lastPromoteDate = undefined;
    g.__lastPromoteAt = undefined;
    vi.spyOn(console, "log").mockImplementation(() => {});
    err = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    if (g.__cronTickerInterval) clearInterval(g.__cronTickerInterval);
    g.__cronTickerInterval = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends the evening digest once, at the configured 18:30", async () => {
    vi.setSystemTime(ist("18:25"));
    startBackgroundCronTicker();
    await minutes(15);
    expect(evening).toEqual(["18:30"]);
  });

  it("never falls back to the 18:00 default when the settings read fails (old behaviour sent it at 18:00)", async () => {
    settingsFails = true;
    vi.setSystemTime(ist("17:57"));
    startBackgroundCronTicker();
    await minutes(10); // 17:58 .. 18:07, every read fails
    expect(evening).toEqual([]);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("Settings unavailable, skipping this minute"), "connection refused");

    settingsFails = false;
    await minutes(30); // recovers, then reaches 18:30
    expect(evening).toEqual(["18:30"]);
  });

  it("does not cache a failed read: it retries on the next minute", async () => {
    settingsFails = true;
    vi.setSystemTime(ist("12:00"));
    startBackgroundCronTicker();
    await minutes(3);
    expect(settingsReads).toBe(3);
    settingsFails = false;
    await minutes(60);
    expect(settingsReads).toBe(4); // one good read, then cached for the rest of the day
  });

  it("reads the settings once for the whole IST day", async () => {
    vi.setSystemTime(ist("09:00"));
    startBackgroundCronTicker();
    await minutes(12 * 60); // 09:01 .. 21:00, including both digests
    expect(settingsReads).toBe(1);
    expect(evening).toEqual(["18:30"]);
  });

  it("an admin change of the evening time applies on the next minute", async () => {
    vi.setSystemTime(ist("18:00"));
    startBackgroundCronTicker();
    await minutes(10); // cached at 18:01 with 18:30
    current = { ...GOOD, evening_digest_time: "18:45" }; // admin saves 18:45 at 18:10
    markTickerSettingsStale();
    await minutes(1);
    expect(settingsReads).toBe(2); // re-read on the very next tick
    await minutes(40); // .. 18:51
    expect(evening).toEqual(["18:45"]); // not 18:30
  });

  it("without an admin save, a changed row is not re-read during the day", async () => {
    vi.setSystemTime(ist("18:00"));
    startBackgroundCronTicker();
    await minutes(10);
    current = { ...GOOD, evening_digest_time: "18:45" }; // e.g. edited directly in the DB, no mark
    await minutes(40);
    expect(settingsReads).toBe(1);
    expect(evening).toEqual(["18:30"]);
  });

  it("a holiday added for today stops today's digest from the next minute", async () => {
    vi.setSystemTime(ist("18:00"));
    startBackgroundCronTicker();
    await minutes(10);
    holidayToday = true; // admin adds today as an office holiday at 18:10
    markTickerSettingsStale();
    await minutes(40);
    expect(evening).toEqual([]);
  });

  it("if the re-read after an admin save fails, it keeps today's values and retries until it succeeds", async () => {
    vi.setSystemTime(ist("18:00"));
    startBackgroundCronTicker();
    await minutes(10); // cached at 18:01 with 18:30
    current = { ...GOOD, evening_digest_time: "18:45" };
    markTickerSettingsStale();
    settingsFails = true;
    await minutes(3); // 18:11 .. 18:13: each re-read fails, the mark is kept
    expect(settingsReads).toBe(4);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("using today's last good values"), "connection refused");
    settingsFails = false;
    await minutes(1); // 18:14: succeeds, picks up 18:45
    expect(settingsReads).toBe(5);
    await minutes(5);
    expect(settingsReads).toBe(5); // mark cleared, back to the day cache
    await minutes(35);
    expect(evening).toEqual(["18:45"]);
  });

  it("reads the settings again after midnight IST", async () => {
    vi.setSystemTime(ist("23:50"));
    startBackgroundCronTicker();
    await minutes(9); // 23:51 .. 23:59
    expect(settingsReads).toBe(1);
    await minutes(5); // 00:00 .. 00:04 on the next day
    expect(settingsReads).toBe(2);
  });

  it("treats a failed holiday lookup as unknown, not as a working day", async () => {
    holidayFails = true;
    vi.setSystemTime(ist("18:28"));
    startBackgroundCronTicker();
    await minutes(10);
    expect(evening).toEqual([]);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("Settings unavailable"), "statement timeout");
  });
});

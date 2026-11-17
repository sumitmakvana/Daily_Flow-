import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Plain functions, not vi.fn(): Vitest fails a test when a vi.fn implementation throws, even if the
// code under test catches it, and these tests need the settings reads to throw.
type Settings = { workdays: number[]; morning_digest_time: string; evening_digest_time: string };
const GOOD: Settings = { workdays: [1, 2, 3, 4, 5], morning_digest_time: "10:30", evening_digest_time: "18:30" };
let settingsFails = false;
let holidayFails = false;
let settingsReads = 0;
const evening: string[] = [];

vi.mock("@/lib/workday-checker.server", () => ({
  readWorkSettingsServer: async (opts: { throwOnError?: boolean } = {}) => {
    settingsReads += 1;
    if (settingsFails) {
      if (opts.throwOnError) throw new Error("connection refused");
      return null;
    }
    return GOOD;
  },
  checkIsWorkingDayServer: async (_d: string, _w: unknown, opts: { throwOnError?: boolean } = {}) => {
    if (holidayFails) {
      if (opts.throwOnError) throw new Error("statement timeout");
      return { isWorkingDay: true };
    }
    return { isWorkingDay: true };
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

describe("CronTicker settings refresh (failed reads)", () => {
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    settingsFails = false;
    holidayFails = false;
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
    await minutes(3);
    expect(settingsReads).toBe(4); // one good read, then cached for the TTL
  });

  it("keeps today's last good values when a later refresh fails", async () => {
    vi.setSystemTime(ist("18:20"));
    startBackgroundCronTicker();
    await minutes(1); // good read at 18:21, cached
    settingsFails = true;
    await minutes(14); // refreshes at 18:26 and later fail, the digest still goes at 18:30
    expect(evening).toEqual(["18:30"]);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("using today's last good values"), "connection refused");
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

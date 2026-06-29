import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatDate, formatRelative, isOverdue, isToday, daysSince, todayISO, nextWorkingDay } from "@/lib/format";

describe("lib/format", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-05-20T12:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  describe("formatDate", () => {
    it("returns em-dash for null/undefined/empty", () => {
      expect(formatDate(null)).toBe("—");
      expect(formatDate(undefined)).toBe("—");
      expect(formatDate("")).toBe("—");
    });
    it("formats valid ISO", () => {
      expect(formatDate("2026-05-20T00:00:00Z")).toMatch(/May/);
    });
  });

  describe("formatRelative", () => {
    it("em-dash on null", () => { expect(formatRelative(null)).toBe("—"); });
    it("just now", () => { expect(formatRelative(new Date().toISOString())).toBe("just now"); });
    it("minutes", () => {
      const t = new Date(Date.now() - 5 * 60000).toISOString();
      expect(formatRelative(t)).toBe("5m ago");
    });
    it("hours", () => {
      const t = new Date(Date.now() - 3 * 3600000).toISOString();
      expect(formatRelative(t)).toBe("3h ago");
    });
    it("days", () => {
      const t = new Date(Date.now() - 4 * 86400000).toISOString();
      expect(formatRelative(t)).toBe("4d ago");
    });
  });

  describe("isOverdue", () => {
    it("false when no date or completed", () => {
      expect(isOverdue(null, "To Do")).toBe(false);
      expect(isOverdue("2020-01-01", "Completed")).toBe(false);
    });
    it("true for past date", () => { expect(isOverdue("2020-01-01", "To Do")).toBe(true); });
    it("false for future date", () => { expect(isOverdue("2099-01-01", "To Do")).toBe(false); });
  });

  describe("isToday", () => {
    it("false on null", () => expect(isToday(null)).toBe(false));
    it("true for today's date", () => expect(isToday(new Date().toISOString())).toBe(true));
    it("false for other days", () => expect(isToday("2020-01-01")).toBe(false));
  });

  describe("daysSince", () => {
    it("0 on null", () => expect(daysSince(null)).toBe(0));
    it("calculates days", () => {
      const t = new Date(Date.now() - 3 * 86400000).toISOString();
      expect(daysSince(t)).toBe(3);
    });
  });

  describe("todayISO", () => {
    it("returns YYYY-MM-DD", () => {
      expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("nextWorkingDay", () => {
    it("skips weekends from Friday", () => {
      // 2026-05-22 is a Friday — next working day should be Monday 25th
      expect(nextWorkingDay("2026-05-22")).toBe("2026-05-25");
    });
    it("uses today when no arg", () => {
      expect(nextWorkingDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    it("advances by one on weekday", () => {
      expect(nextWorkingDay("2026-05-20")).toBe("2026-05-21");
    });
    it("skips Sunday when starting Saturday", () => {
      expect(nextWorkingDay("2026-05-23")).toBe("2026-05-25");
    });
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PUSH_TABLES } from "@/integrations/realtime/channel";

// Pages must refresh from Socket.IO events for the data they show, and only the affected data.

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");

describe("worklog / leave / EOD changes are pushed", () => {
  it.each(["task_worklogs", "leaves", "eod_checkins"])("%s is a push table", (t) => {
    expect(PUSH_TABLES.has(t)).toBe(true);
  });
});

describe("pages subscribe to what they show", () => {
  it("Team Capacity refreshes on task+worklog events and on leave events (it had no realtime before)", () => {
    const src = read("src/routes/_authenticated/team-capacity.tsx");
    expect(src).toMatch(/useRealtimeRefresh\(\s*\["tasks", "task_worklogs"\]/);
    expect(src).toMatch(/useRealtimeRefresh\(\s*\["leaves"\]/);
  });
  it("EOD board re-reads only check-ins on eod_checkins events", () => {
    const src = read("src/routes/_authenticated/eod.tsx");
    expect(src).toMatch(/useRealtimeRefresh\(\s*\["eod_checkins"\]/);
  });
  it("Calendar re-reads only leaves on leave events", () => {
    expect(read("src/routes/_authenticated/calendar.tsx")).toMatch(/useRealtimeRefresh\(\s*\["leaves"\]/);
  });
  it("Executive refreshes check-ins and leaves independently of tasks", () => {
    const src = read("src/routes/_authenticated/executive.tsx");
    expect(src).toMatch(/\["eod_checkins"\][\s\S]{0,120}exec-checkins/);
    expect(src).toMatch(/\["leaves"\][\s\S]{0,120}exec-active-leaves/);
  });
});

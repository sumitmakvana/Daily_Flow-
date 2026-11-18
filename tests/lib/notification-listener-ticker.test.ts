// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The notification listener also LISTENs on ticker_settings_changed (triggers on work_settings / holiday_calendar)
// and marks the CronTicker settings cache stale: on every message, and after every (re)connect.
const h = vi.hoisted(() => ({
  client: null as unknown as EventEmitter & { query: (s: string) => Promise<unknown>; release: () => void },
  queries: [] as string[],
  connects: 0,
  poolQuery: vi.fn(),
  emitToUser: vi.fn(),
}));

vi.mock("@/lib/realtime.server", () => ({
  emitToUser: (...a: unknown[]) => h.emitToUser(...a),
  emitToRooms: vi.fn(),
  hasUserSockets: () => false,
}));
vi.mock("@/services/email-dispatcher", () => ({ sendEodEmail: vi.fn() }));
vi.mock("@/services/email-templates", () => ({
  getZeroTasksNudgeHtml: vi.fn(),
  getUnstartedTasksNudgeHtml: vi.fn(),
  getUncompletedEodTasksHtml: vi.fn(),
  getGeneralNotificationHtml: vi.fn(),
  getLeaveNotificationHtml: vi.fn(),
  getMultiTaskAssignmentHtml: vi.fn(),
}));
vi.mock("@/integrations/postgres/client.server", () => ({
  getPool: () => ({
    query: (...a: unknown[]) => h.poolQuery(...a),
    connect: async () => {
      h.connects += 1;
      return h.client;
    },
  }),
}));

const newClient = () =>
  Object.assign(new EventEmitter(), {
    query: async (s: string) => {
      h.queries.push(s);
      return {};
    },
    release: () => {},
  });

let take: () => boolean;
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.__isNotificationListening;
  delete g.__notificationClient;
  process.env.OPERON_READ_ONLY = "1"; // no startup DDL: keeps the statement list to the LISTENs
  h.queries = [];
  h.connects = 0;
  h.poolQuery.mockReset();
  h.poolQuery.mockResolvedValue({ rows: [] });
  h.client = newClient();
  vi.spyOn(console, "log").mockImplementation(() => {});
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  ({ takeTickerSettingsStale: take } = await import("@/lib/ticker-settings-cache.server"));
  take(); // start clean
});
afterEach(() => {
  delete process.env.OPERON_READ_ONLY;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const listening = () => h.queries.filter((q) => q === "LISTEN ticker_settings_changed").length;
const start = async () => {
  const { startNotificationListener } = await import("@/lib/notification-listener.server");
  startNotificationListener();
  await vi.waitFor(() => expect(listening()).toBe(1));
};

describe("notification listener: ticker_settings_changed", () => {
  it("LISTENs on the channel and marks the settings stale once connected", async () => {
    await start();
    expect(take()).toBe(true);
    expect(take()).toBe(false);
  });

  it("marks the settings stale on every message, with a plain-text payload (not JSON)", async () => {
    await start();
    take();
    h.client.emit("notification", { channel: "ticker_settings_changed", payload: "work_settings" });
    expect(take()).toBe(true);
    h.client.emit("notification", { channel: "ticker_settings_changed", payload: "holiday_calendar" });
    expect(take()).toBe(true);
    expect(errors).not.toHaveBeenCalled(); // no "Payload error" from JSON.parse
    expect(h.emitToUser).not.toHaveBeenCalled();
  });

  it("other channels do not touch the settings cache", async () => {
    await start();
    take();
    h.client.emit("notification", {
      channel: "new_notification",
      payload: JSON.stringify({ id: "n1", user_id: "u1", type: "eod_digest", title: "T", body: "B", task_id: null }),
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(take()).toBe(false);
  });

  it("marks the settings stale again after a reconnect (changes made while disconnected are not lost)", async () => {
    vi.useFakeTimers();
    await start();
    take();
    h.client.emit("end"); // connection lost
    h.client = newClient();
    expect(take()).toBe(false); // nothing yet: still disconnected
    await vi.advanceTimersByTimeAsync(5_000); // the listener's reconnect delay
    await vi.waitFor(() => expect(listening()).toBe(2));
    expect(h.connects).toBe(2);
    expect(take()).toBe(true);
  });
});

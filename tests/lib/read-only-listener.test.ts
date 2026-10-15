// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  client: null as unknown as EventEmitter & { query: (s: string) => Promise<unknown>; release: () => void },
  queries: [] as string[],
  poolQuery: vi.fn(),
  emitToUser: vi.fn(),
  sendEodEmail: vi.fn(),
}));

vi.mock("@/lib/realtime.server", () => ({
  emitToUser: (...a: unknown[]) => h.emitToUser(...a),
  emitToRooms: vi.fn(),
}));
vi.mock("@/services/email-dispatcher", () => ({ sendEodEmail: (...a: unknown[]) => h.sendEodEmail(...a) }));
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
    connect: async () => h.client,
  }),
}));

const setMode = (v: string | undefined) => {
  if (v === undefined) delete process.env.OPERON_READ_ONLY;
  else process.env.OPERON_READ_ONLY = v;
};
const resetGlobals = () => {
  const g = globalThis as unknown as Record<string, unknown>;
  delete g.__isNotificationListening;
  delete g.__notificationClient;
};

beforeEach(() => {
  vi.resetModules();
  resetGlobals();
  h.queries = [];
  h.emitToUser.mockClear();
  h.sendEodEmail.mockClear();
  h.poolQuery.mockReset();
  h.poolQuery.mockResolvedValue({ rows: [] });
  h.client = Object.assign(new EventEmitter(), {
    query: async (s: string) => {
      h.queries.push(s);
      return {};
    },
    release: () => {},
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setMode(undefined);
  resetGlobals();
  vi.restoreAllMocks();
});

const start = async () => {
  const { startNotificationListener } = await import("@/lib/notification-listener.server");
  startNotificationListener();
  await vi.waitFor(() => expect(h.queries.some((q) => q.includes("LISTEN entity_changed"))).toBe(true));
};
const statements = () => h.queries.join("\n");
const notify = (n: Record<string, unknown>) =>
  h.client.emit("notification", { channel: "new_notification", payload: JSON.stringify(n) });
const row = { id: "n1", user_id: "u1", type: "eod_digest", title: "T", body: "B", task_id: null };

describe("notification listener startup", () => {
  it("READ-ONLY: issues NO DDL and NO write — only LISTEN", async () => {
    setMode("1");
    await start();
    expect(h.queries).toEqual(["LISTEN new_notification", "LISTEN entity_changed"]);
    expect(statements()).not.toMatch(/CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE/i);
  });

  it("normal mode: still installs the notification trigger (behaviour unchanged)", async () => {
    setMode(undefined);
    await start();
    expect(statements()).toMatch(/CREATE OR REPLACE FUNCTION public\.notify_notification_inserted/);
    expect(statements()).toMatch(/CREATE TRIGGER trg_notification_inserted/);
    expect(statements()).toMatch(/LISTEN new_notification/);
  });
});

describe("notification listener per-event behaviour", () => {
  it("READ-ONLY: a production notification is pushed to sockets but triggers NO database read and NO email", async () => {
    setMode("1");
    await start();
    notify(row);
    await new Promise((r) => setTimeout(r, 60));
    expect(h.emitToUser).toHaveBeenCalledWith("u1", "notification:new", expect.objectContaining({ id: "n1" }));
    expect(h.poolQuery).not.toHaveBeenCalled();
    expect(h.sendEodEmail).not.toHaveBeenCalled();
  });

  it("READ-ONLY: an entity_changed message is still routed to sockets (and does no DB work)", async () => {
    setMode("1");
    await start();
    h.client.emit("notification", {
      channel: "entity_changed",
      payload: JSON.stringify({ table: "tasks", op: "UPDATE", id: "t1", assigned_to: "a", reviewer: null, old_assigned_to: "a", old_reviewer: null }),
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(h.poolQuery).not.toHaveBeenCalled();
    expect(h.sendEodEmail).not.toHaveBeenCalled();
  });

  it("normal mode: the same notification still goes on to the email path (reads user + prefs)", async () => {
    setMode(undefined);
    await start();
    notify(row);
    await vi.waitFor(() => expect(h.poolQuery).toHaveBeenCalled());
    expect(h.emitToUser).toHaveBeenCalledTimes(1);
  });
});

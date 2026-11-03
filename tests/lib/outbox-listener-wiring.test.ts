// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const created: Array<{ opts: Record<string, unknown>; client: FakePg }> = [];
class FakePg extends EventEmitter {
  queries: string[] = [];
  constructor(public opts: Record<string, unknown>) {
    super();
    created.push({ opts, client: this });
  }
  async connect() {}
  async query(text: string) {
    this.queries.push(text);
    if (text.includes("COALESCE(max(id), 0)")) return { rows: [{ max: 0 }] };
    if (text.includes("pg_trigger")) {
      const { REQUIRED_TRIGGERS } = await import("@/lib/outbox-listener.server");
      return { rows: REQUIRED_TRIGGERS.map((tgname) => ({ tgname, tgenabled: "O" })) };
    }
    return { rows: [] };
  }
  async end() {}
}
vi.mock("pg", () => ({ Client: FakePg }));

const emitToRooms = vi.fn();
vi.mock("@/lib/realtime.server", () => ({ emitToRooms: (...a: unknown[]) => emitToRooms(...a) }));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const g = globalThis as unknown as { __operonOutboxListener?: { stop(): Promise<void> } };

beforeEach(() => {
  created.length = 0;
  emitToRooms.mockReset();
  vi.resetModules();
  delete process.env.OPERON_READ_ONLY;
  process.env.DATABASE_URL = "postgres://u:p@db:5432/app";
});
afterEach(async () => {
  await g.__operonOutboxListener?.stop();
  delete g.__operonOutboxListener;
  delete process.env.DATABASE_URL;
  delete process.env.OPERON_READ_ONLY;
});

describe("startOutboxListener (production wiring)", () => {
  it("uses its OWN connection (not the shared pool) with TCP keepalive, and LISTENs on the outbox channel", async () => {
    const { startOutboxListener } = await import("@/lib/outbox-listener.server");
    startOutboxListener();
    await wait(20);
    expect(created).toHaveLength(1);
    expect(created[0].opts).toMatchObject({
      connectionString: "postgres://u:p@db:5432/app",
      keepAlive: true,
      application_name: "operon-realtime",
    });
    expect(created[0].client.queries[0]).toBe("LISTEN realtime_outbox");
  });

  it("is a singleton: calling it again (HMR, double import) never opens a second LISTEN connection", async () => {
    const { startOutboxListener } = await import("@/lib/outbox-listener.server");
    const a = startOutboxListener();
    const b = startOutboxListener();
    await wait(20);
    expect(a).toBe(b);
    expect(created).toHaveLength(1);
  });

  it("read-only mode: session is read-only at the database level, and nothing is pruned or written", async () => {
    process.env.OPERON_READ_ONLY = "1";
    const { startOutboxListener } = await import("@/lib/outbox-listener.server");
    startOutboxListener();
    await wait(20);
    expect(created[0].opts.options).toBe("-c default_transaction_read_only=on");
    expect(created[0].opts.application_name).toBe("operon-realtime-readonly");
    expect(created[0].client.queries.some((q) => /^(DELETE|INSERT|UPDATE|ALTER|CREATE|DROP)/i.test(q))).toBe(false);
  });

  it("without DATABASE_URL it says so loudly and does not start", async () => {
    delete process.env.DATABASE_URL;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startOutboxListener } = await import("@/lib/outbox-listener.server");
    expect(startOutboxListener()).toBeNull();
    expect(err.mock.calls.join(" ")).toMatch(/DATABASE_URL is not set: live updates are DISABLED/);
    err.mockRestore();
  });

  it("a NOTIFY becomes a routed Socket.IO emit to exactly the audience, via the batcher", async () => {
    const { startOutboxListener } = await import("@/lib/outbox-listener.server");
    startOutboxListener();
    await wait(20);
    created[0].client.emit("notification", {
      channel: "realtime_outbox",
      payload: JSON.stringify({ id: 7, table: "leaves", op: "INSERT", row_id: "l1", keys: { user_id: "u1", request_to: "m1", reason: "must never be forwarded" } }),
    });
    await wait(250); // batcher window
    expect(emitToRooms).toHaveBeenCalledTimes(1);
    const [rooms, event, payload] = emitToRooms.mock.calls[0];
    expect([...rooms].sort()).toEqual(["role:manager", "user:m1", "user:u1"]);
    expect(event).toBe("entity:changed");
    expect(payload).toMatchObject({ table: "leaves", eventType: "INSERT", new: { id: "l1", user_id: "u1" } });
    expect(JSON.stringify(payload)).not.toContain("must never be forwarded");
  });

  it("a payload cannot spoof its own table/op/id through the routing keys", async () => {
    const { startOutboxListener } = await import("@/lib/outbox-listener.server");
    startOutboxListener();
    await wait(20);
    created[0].client.emit("notification", {
      channel: "realtime_outbox",
      payload: JSON.stringify({ id: 8, table: "nudges", op: "INSERT", row_id: "n1", keys: { user_id: "bob", table: "risk_events", op: "DELETE", id: "forged" } }),
    });
    await wait(250);
    const [rooms, , payload] = emitToRooms.mock.calls[0];
    expect(rooms).toEqual(["user:bob"]);
    expect(payload).toMatchObject({ table: "nudges", eventType: "INSERT", new: { id: "n1" } });
  });
});

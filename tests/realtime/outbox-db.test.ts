// @vitest-environment node
/**
 * Real-Postgres tests for the transactional outbox: triggers, NOTIFY, permissions, atomicity,
 * recovery after a killed connection, and the full path DB write -> listener -> real sockets.
 *
 * Runs only when SCRATCH_PG_URL points at a Postgres server where the user may CREATE DATABASE; the
 * suite creates (and drops) its own database `rt_outbox_test` there, e.g.
 *   docker run -d --name rt-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=scratch -p 54329:5432 postgres:16
 *   SCRATCH_PG_URL=postgres://postgres:test@127.0.0.1:54329/scratch npx vitest run tests/realtime/outbox-db.test.ts
 */
import { readFileSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { Client } from "pg";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EntityEventBatcher, type EntityMessage } from "@/lib/entity-events.server";
import { OutboxListener, REQUIRED_TRIGGERS, type ListenClient, type OutboxMessage } from "@/lib/outbox-listener.server";

vi.mock("@/integrations/backend/jwt.server", () => ({
  verifyBackendJwt: async (t: string) => {
    const [sub, exp] = t.split(":");
    if (!sub || !exp) throw new Error("invalid");
    return { sub, exp: Number(exp) };
  },
}));
vi.mock("@/integrations/postgres/client.server", () => ({
  getPool: () => ({
    query: async (_s: string, [u]: string[]) => ({
      rows: u === "mgr" ? [{ role: "manager" }] : u === "boss" ? [{ role: "admin" }] : [],
    }),
  }),
}));

vi.setConfig({ testTimeout: 30_000 }); // real reconnects, real timers

const url = process.env.SCRATCH_PG_URL;
// The suite works in its OWN database (created and dropped here) so it can never disturb other
// tests or data that share SCRATCH_PG_URL.
const TEST_DB = "rt_outbox_test";
let dbUrl = "";
const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const MIGRATION = "supabase/migrations/20261031000000_realtime_outbox.sql";
const REMOVE_AUTOMATION = "supabase/migrations/20261105020000_remove_automation.sql";
const ROLLBACK = "supabase/rollbacks/20261031000000_realtime_outbox.down.sql";
const FIXTURE = "tests/fixtures/realtime-schema.sql";

const U = {
  alice: "00000000-0000-0000-0000-00000000000a",
  bob: "00000000-0000-0000-0000-00000000000b",
  rita: "00000000-0000-0000-0000-0000000000c1",
  rev2: "00000000-0000-0000-0000-0000000000c2",
  cat: "00000000-0000-0000-0000-0000000000d1",
  mgr: "00000000-0000-0000-0000-0000000000e1",
  boss: "00000000-0000-0000-0000-0000000000e2",
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean | Promise<boolean>, ms = 6000, what = "condition") {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await wait(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe.skipIf(!url)("transactional outbox on a real Postgres", () => {
  let admin: Client;
  const extra: Client[] = [];
  const newClient = async () => {
    const c = new Client({ connectionString: dbUrl });
    await c.connect();
    extra.push(c);
    return c;
  };
  const q = (text: string, values?: unknown[]) => admin.query(text, values);
  const outbox = async () => (await q("SELECT id, table_name, op, row_id, payload FROM realtime.outbox ORDER BY id")).rows;
  const clearOutbox = () => q("TRUNCATE realtime.outbox");

  beforeAll(async () => {
    const root = new Client({ connectionString: url });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await root.query(`CREATE DATABASE ${TEST_DB}`);
    await root.end();
    const u = new URL(url!);
    u.pathname = `/${TEST_DB}`;
    dbUrl = u.toString();
    admin = new Client({ connectionString: dbUrl });
    await admin.connect();
    await q(read(FIXTURE));
    await q(read(MIGRATION));
    await q(read(REMOVE_AUTOMATION));
  });
  afterAll(async () => {
    for (const c of extra) await c.end().catch(() => {});
    await admin.end();
    const root = new Client({ connectionString: url });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await root.end();
  });
  beforeEach(async () => {
    // fixture rows are created with owner privileges; keep each test independent
    await q("TRUNCATE public.tasks, public.task_reviewers, public.task_review_decisions, public.task_worklogs, public.leaves, public.eod_checkins, public.nudges, public.risk_events, public.planning_suggestions, public.approval_requests, public.approval_steps, public.approval_chains, public.user_roles RESTART IDENTITY CASCADE");
    await clearOutbox();
  });

  describe("migration", () => {
    it("installs a row trigger + a TRUNCATE trigger per watched table, all ENABLE ALWAYS, matching what the app verifies", async () => {
      const { rows } = await q("SELECT tgname, tgenabled FROM pg_trigger WHERE tgname LIKE 'trg\\_realtime\\_%' AND NOT tgisinternal");
      expect(rows.map((r) => r.tgname).sort()).toEqual([...REQUIRED_TRIGGERS].sort());
      expect(rows.every((r) => r.tgenabled === "A")).toBe(true);
    });

    it("is idempotent: applying it twice changes nothing and loses no outbox rows", async () => {
      await q("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]);
      await q(read(MIGRATION));
      await q(read(REMOVE_AUTOMATION));
      const { rows } = await q("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'trg\\_realtime\\_%' AND NOT tgisinternal");
      expect(rows[0].n).toBe(REQUIRED_TRIGGERS.length);
      expect(await outbox()).toHaveLength(1);
    });
  });

  describe("every table produces an event with ids only", () => {
    it("tasks: INSERT / UPDATE / DELETE carry the routing user ids, previous assignee, and all reviewers", async () => {
      const t = (await q("INSERT INTO tasks (assigned_to, reviewer, created_by) VALUES ($1,$2,$3) RETURNING id", [U.alice, U.rita, U.cat])).rows[0].id;
      await q("INSERT INTO task_reviewers VALUES ($1,$2), ($1,$3)", [t, U.rita, U.rev2]);
      await clearOutbox();
      await q("UPDATE tasks SET assigned_to = $2, status = 'Blocked' WHERE id = $1", [t, U.bob]);
      await q("DELETE FROM tasks WHERE id = $1", [t]);
      const [upd, del] = await outbox();
      expect(upd).toMatchObject({ table_name: "tasks", op: "UPDATE", row_id: t });
      expect(upd.payload).toMatchObject({ assigned_to: U.bob, old_assigned_to: U.alice, reviewer: U.rita, old_reviewer: U.rita, created_by: U.cat });
      expect([...upd.payload.reviewers].sort()).toEqual([U.rita, U.rev2].sort());
      expect(del).toMatchObject({ table_name: "tasks", op: "DELETE", row_id: t });
      expect(del.payload.assigned_to).toBe(U.bob);
    });

    it("leaves, worklogs, eod_checkins, nudges, risk_events, planning_suggestions: right keys per table", async () => {
      const t = (await q("INSERT INTO tasks (assigned_to) VALUES ($1) RETURNING id", [U.alice])).rows[0].id;
      await clearOutbox();
      await q("INSERT INTO leaves (user_id, request_to, reviewed_by) VALUES ($1,$2,$3)", [U.alice, U.mgr, U.boss]);
      await q("INSERT INTO task_worklogs (task_id, user_id) VALUES ($1,$2)", [t, U.bob]);
      await q("INSERT INTO eod_checkins (user_id) VALUES ($1)", [U.alice]);
      await q("INSERT INTO nudges (user_id) VALUES ($1)", [U.bob]);
      await q("INSERT INTO risk_events (entity_type, entity_id) VALUES ('task', $1)", [t]);
      await q("INSERT INTO planning_suggestions (task_id, from_user_id, to_user_id) VALUES ($1,$2,$3)", [t, U.alice, U.bob]);
      const by = Object.fromEntries((await outbox()).map((r) => [r.table_name, r.payload]));
      expect(by.leaves).toEqual({ user_id: U.alice, request_to: U.mgr, reviewed_by: U.boss });
      expect(by.task_worklogs).toEqual({ user_id: U.bob, task_id: t, assigned_to: U.alice }); // the TASK's assignee is looked up
      expect(by.eod_checkins).toEqual({ user_id: U.alice });
      expect(by.nudges).toEqual({ user_id: U.bob });
      expect(by.risk_events).toEqual({ entity_type: "task", entity_id: t });
      expect(by.planning_suggestions).toEqual({ task_id: t, from_user_id: U.alice, to_user_id: U.bob });
    });

    it("task_review_decisions: reviewer, decider, the other reviewers and the task's assignee", async () => {
      const t = (await q("INSERT INTO tasks (assigned_to) VALUES ($1) RETURNING id", [U.alice])).rows[0].id;
      await q("INSERT INTO task_reviewers VALUES ($1,$2), ($1,$3)", [t, U.rita, U.rev2]);
      await clearOutbox();
      await q("INSERT INTO task_review_decisions (task_id, reviewer_id, decided_by) VALUES ($1,$2,$3)", [t, U.rita, U.mgr]);
      const [r] = await outbox();
      expect(r.payload).toMatchObject({ task_id: t, reviewer_id: U.rita, decided_by: U.mgr, assigned_to: U.alice });
      expect([...r.payload.reviewers].sort()).toEqual([U.rita, U.rev2].sort());
    });

    it("approval_requests: requester + every resolved approver (user step, role step, reviewer_field step)", async () => {
      const t = (await q("INSERT INTO tasks (assigned_to, reviewer) VALUES ($1,$2) RETURNING id", [U.alice, U.rita])).rows[0].id;
      const chain = (await q("INSERT INTO approval_chains DEFAULT VALUES RETURNING id")).rows[0].id;
      await q("INSERT INTO approval_steps (chain_id, step_order, approver_mode, approver_user_id) VALUES ($1,1,'user',$2)", [chain, U.cat]);
      await q("INSERT INTO approval_steps (chain_id, step_order, approver_mode, approver_role) VALUES ($1,2,'role','manager')", [chain]);
      await q("INSERT INTO approval_steps (chain_id, step_order, approver_mode) VALUES ($1,3,'reviewer_field')", [chain]);
      await q("INSERT INTO user_roles (user_id, role) VALUES ($1,'manager'), ($2,'admin'), ($3,'member')", [U.mgr, U.boss, U.bob]);
      await clearOutbox();
      await q("INSERT INTO approval_requests (work_item_id, chain_id, requested_by) VALUES ($1,$2,$3)", [t, chain, U.alice]);
      const [r] = await outbox();
      expect(r.payload.requested_by).toBe(U.alice);
      // user step (cat) + role step (the manager) + reviewer_field (the task's reviewer); NOT bob (member) or boss (admin: routed by role)
      expect([...r.payload.approvers].sort()).toEqual([U.cat, U.mgr, U.rita].sort());
    });

    it("the outbox and NOTIFY never contain row content: only uuids, or null (checked for every table)", async () => {
      const t = (await q("INSERT INTO tasks (assigned_to, reviewer, created_by, task_name, status) VALUES ($1,$2,$3,'TOP SECRET NAME','Blocked') RETURNING id", [U.alice, U.rita, U.cat])).rows[0].id;
      await q("INSERT INTO task_reviewers VALUES ($1,$2)", [t, U.rita]);
      const l = await newClient();
      await l.query("LISTEN realtime_outbox");
      const heard: string[] = [];
      l.on("notification", (n) => heard.push(n.payload ?? ""));
      await q("UPDATE tasks SET task_name = 'TOP SECRET RENAMED', status = 'In Progress' WHERE id = $1", [t]);
      await q("INSERT INTO leaves (user_id, request_to, reason) VALUES ($1,$2,'TOP SECRET REASON')", [U.alice, U.mgr]);
      await q("INSERT INTO eod_checkins (user_id, note) VALUES ($1,'TOP SECRET NOTE')", [U.alice]);
      await q("INSERT INTO nudges (user_id, message) VALUES ($1,'TOP SECRET NUDGE')", [U.bob]);
      await q("INSERT INTO risk_events (entity_type, entity_id, detail) VALUES ('task',$1,'TOP SECRET DETAIL')", [t]);
      await q("INSERT INTO task_review_decisions (task_id, reviewer_id, feedback) VALUES ($1,$2,'TOP SECRET FEEDBACK')", [t, U.rita]);
      await until(() => heard.length >= 6, 4000, "notifications");
      const everything = JSON.stringify(await outbox()) + heard.join("");
      expect(everything).not.toMatch(/SECRET|Blocked|In Progress/);
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      for (const r of await outbox()) {
        for (const [k, v] of Object.entries(r.payload as Record<string, unknown>)) {
          const vals = Array.isArray(v) ? v : [v];
          for (const x of vals) expect(typeof x === "string" && (uuid.test(x) || ["task"].includes(x)), `${r.table_name}.${k}=${String(x)}`).toBe(true);
        }
      }
    });
  });

  describe("what is NOT an event", () => {
    it("an UPDATE that changes nothing", async () => {
      const t = (await q("INSERT INTO tasks (assigned_to) VALUES ($1) RETURNING id", [U.alice])).rows[0].id;
      await clearOutbox();
      await q("UPDATE tasks SET status = status WHERE id = $1", [t]);
      await q("UPDATE tasks SET status = 'To Do' WHERE id = $1", [t]);
      expect(await outbox()).toHaveLength(0);
    });

    it("a rolled-back transaction: no outbox row and no NOTIFY", async () => {
      const l = await newClient();
      await l.query("LISTEN realtime_outbox");
      const heard: string[] = [];
      l.on("notification", (n) => heard.push(n.payload ?? ""));
      const c = await newClient();
      await c.query("BEGIN");
      await c.query("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]);
      await c.query("ROLLBACK");
      await wait(300);
      expect(await outbox()).toHaveLength(0);
      expect(heard).toHaveLength(0);
    });

    it("a committed transaction is announced only AFTER commit", async () => {
      const l = await newClient();
      await l.query("LISTEN realtime_outbox");
      const heard: string[] = [];
      l.on("notification", (n) => heard.push(n.payload ?? ""));
      const c = await newClient();
      await c.query("BEGIN");
      await c.query("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]);
      await wait(300);
      expect(heard).toHaveLength(0); // not visible, not announced
      await c.query("COMMIT");
      await until(() => heard.length === 1, 3000, "post-commit notification");
    });
  });

  describe("every write path is covered", () => {
    it("pg_restore / replica-mode sessions (session_replication_role = replica) still fire (ENABLE ALWAYS)", async () => {
      const c = await newClient();
      await c.query("SET session_replication_role = replica");
      await c.query("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]);
      expect((await outbox()).map((r) => r.op)).toEqual(["INSERT"]);
    });

    it("TRUNCATE is announced (one bulk event per table)", async () => {
      await q("INSERT INTO leaves (user_id) VALUES ($1)", [U.alice]);
      await clearOutbox();
      await q("TRUNCATE public.leaves");
      expect(await outbox()).toMatchObject([{ table_name: "leaves", op: "TRUNCATE", row_id: null }]);
    });

    it("a write by the browser-facing role (what PostgREST uses) produces an event", async () => {
      const c = await newClient();
      await c.query("SET ROLE authenticated");
      await c.query("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]);
      await c.query("INSERT INTO leaves (user_id) VALUES ($1)", [U.alice]);
      await c.query("RESET ROLE");
      expect((await outbox()).map((r) => r.table_name).sort()).toEqual(["leaves", "tasks"]);
    });
  });

  describe("security: browsers can neither read nor forge events", () => {
    const denied = async (sql: string) => {
      const c = await newClient();
      await c.query("SET ROLE authenticated");
      await expect(c.query(sql)).rejects.toThrow(/permission denied/);
    };
    it("authenticated cannot SELECT the outbox", () => denied("SELECT * FROM realtime.outbox"));
    it("authenticated cannot INSERT into the outbox", () => denied("INSERT INTO realtime.outbox (table_name, op) VALUES ('tasks','UPDATE')"));
    it("authenticated cannot call emit() or the capture functions", async () => {
      await denied("SELECT realtime.emit('tasks','UPDATE','x','{}')");
      await denied("SELECT realtime.capture_statement()");
    });
    it("defence in depth: even if schema USAGE were ever granted, the table, sequence and functions still deny", async () => {
      await q("GRANT USAGE ON SCHEMA realtime TO authenticated, anon");
      try {
        await denied("SELECT * FROM realtime.outbox");
        await denied("INSERT INTO realtime.outbox (table_name, op) VALUES ('tasks','UPDATE')");
        await denied("SELECT nextval('realtime.outbox_id_seq')");
        await denied("SELECT realtime.emit('tasks','UPDATE','x','{}')");
      } finally {
        await q("REVOKE USAGE ON SCHEMA realtime FROM authenticated, anon");
      }
    });
    it("anon has no access either", async () => {
      const c = await newClient();
      await c.query("SET ROLE anon");
      await expect(c.query("SELECT * FROM realtime.outbox")).rejects.toThrow(/permission denied/);
    });
    it("the schema is outside PostgREST's exposed schemas (public only) and RLS is on with no policy", async () => {
      const { rows } = await q("SELECT relrowsecurity FROM pg_class WHERE oid = 'realtime.outbox'::regclass");
      expect(rows[0].relrowsecurity).toBe(true);
      expect((await q("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'realtime'")).rows[0].n).toBe(0);
    });
  });

  describe("atomicity: no committed change without an outbox row", () => {
    it("if the event cannot be recorded, the write fails with it (nothing is committed silently)", async () => {
      await q("ALTER TABLE realtime.outbox ADD CONSTRAINT boom CHECK (false) NOT VALID");
      try {
        await expect(q("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice])).rejects.toThrow(/boom/);
        expect((await q("SELECT count(*)::int AS n FROM tasks")).rows[0].n).toBe(0);
      } finally {
        await q("ALTER TABLE realtime.outbox DROP CONSTRAINT boom");
      }
      await q("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]);
      expect(await outbox()).toHaveLength(1);
    });

    it("an oversized event degrades to an id-only NOTIFY, with the full keys safe in the outbox", async () => {
      const t = (await q("INSERT INTO tasks (assigned_to) VALUES ($1) RETURNING id", [U.alice])).rows[0].id;
      await q("INSERT INTO task_reviewers SELECT $1, gen_random_uuid() FROM generate_series(1, 400)", [t]);
      await clearOutbox();
      const l = await newClient();
      await l.query("LISTEN realtime_outbox");
      const heard: string[] = [];
      l.on("notification", (n) => heard.push(n.payload ?? ""));
      await q("UPDATE tasks SET status = 'Done' WHERE id = $1", [t]);
      await until(() => heard.length === 1, 3000, "oversized notification");
      expect(Object.keys(JSON.parse(heard[0]))).toEqual(["id"]);
      expect((await outbox())[0].payload.reviewers).toHaveLength(400);
    });
  });

  describe("listener against the real database", () => {
    let listener: OutboxListener;
    let listenerClients: Client[];
    let delivered: OutboxMessage[];
    let errs: string[];
    const start = async (extraOpts: Partial<ConstructorParameters<typeof OutboxListener>[0]> = {}) => {
      listenerClients = [];
      delivered = [];
      errs = [];
      listener = new OutboxListener({
        createClient: () => {
          const c = new Client({ connectionString: dbUrl });
          listenerClients.push(c);
          return c as unknown as ListenClient;
        },
        deliver: (m) => delivered.push(m),
        onGap: () => errs.push("GAP"),
        error: (m) => errs.push(m),
        log: () => {},
        backoffBaseMs: 100,
        ...extraOpts,
      });
      listener.start();
      await until(() => listener.status().connected, 5000, "listener connected");
    };
    const kill = async (c: Client) => {
      const pid = (c as unknown as { processID: number }).processID;
      await q("SELECT pg_terminate_backend($1)", [pid]);
    };
    afterEach(async () => {
      await listener?.stop();
    });

    it("delivers real trigger events, once each, in order, with no missing triggers reported", async () => {
      await start();
      expect(listener.status().missingTriggers).toEqual([]);
      await q("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]);
      await q("INSERT INTO leaves (user_id) VALUES ($1)", [U.bob]);
      await until(() => delivered.length === 2, 4000, "two events");
      expect(delivered.map((m) => m.table)).toEqual(["tasks", "leaves"]);
      expect(delivered[0].keys).toMatchObject({ assigned_to: U.alice });
    });

    it("KILLING the listener's backend: it reconnects, and changes made during the outage are replayed exactly once", async () => {
      await start();
      await q("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]);
      await until(() => delivered.length === 1, 4000, "first event");

      await kill(listenerClients[0]);
      await q("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]); // during the outage
      await q("INSERT INTO leaves (user_id) VALUES ($1)", [U.bob]);
      await q("UPDATE tasks SET status = 'In Progress'"); // 2 task rows exist now: 2 events
      await until(() => listenerClients.length >= 2 && listener.status().connected, 8000, "reconnect");
      await until(() => delivered.length === 5, 6000, "replay");
      await wait(300);
      // 1 before the outage + 1 task insert + 1 leave + 2 task updates, each exactly once (no NOTIFY+replay duplicates)
      expect(delivered).toHaveLength(5);
      expect(new Set(delivered.map((m) => m.id)).size).toBe(5);
      expect(listener.status().reconnects).toBeGreaterThanOrEqual(1);
      expect(errs.some((e) => /listener connection lost/.test(e))).toBe(true); // loudly reported
      expect(errs).not.toContain("GAP");
    });

    it("a connection killed server-side is detected from the socket close and recovered", async () => {
      await start();
      await kill(listenerClients[0]);
      await until(() => listenerClients.length >= 2 && listener.status().connected, 8000, "reconnect");
      await q("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]);
      await until(() => delivered.length === 1, 4000, "event after reconnect");
    });

    it("a transaction that commits OUT OF ORDER (lower id after a higher one) is delivered in both live and reconnect cases", async () => {
      await start();
      const slow = await newClient();
      await slow.query("BEGIN");
      await slow.query("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]); // takes the lower id, not committed yet
      await q("INSERT INTO leaves (user_id) VALUES ($1)", [U.bob]); // higher id, commits first
      await until(() => delivered.length === 1, 4000, "fast commit");
      await slow.query("COMMIT"); // live: the lower id arrives after the higher one
      await until(() => delivered.length === 2, 4000, "late commit");
      expect(delivered.map((m) => m.table).sort()).toEqual(["leaves", "tasks"]);

      // same race across a disconnect
      const slow2 = await newClient();
      await slow2.query("BEGIN");
      await slow2.query("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.bob]); // lower id
      await q("INSERT INTO leaves (user_id) VALUES ($1)", [U.alice]); // higher id
      await until(() => delivered.length === 3, 4000, "fast commit 2");
      await kill(listenerClients[listenerClients.length - 1]);
      await slow2.query("COMMIT"); // commits while the listener is down: its NOTIFY is lost
      await until(() => delivered.length === 4, 8000, "replayed late commit");
      expect(new Set(delivered.map((m) => m.id)).size).toBe(4);
    });

    it("starts cleanly with the outbox missing: loud error, no crash, no reconnect loop", async () => {
      await q("ALTER SCHEMA realtime RENAME TO realtime_off");
      try {
        await start();
        expect(listener.status().degraded).toBe("outbox-missing");
        expect(errs.join("\n")).toMatch(/20261031000000_realtime_outbox\.sql/);
        expect(listener.status().reconnects).toBe(0);
      } finally {
        await listener.stop();
        await q("ALTER SCHEMA realtime_off RENAME TO realtime");
      }
    });
  });

  describe("end to end: database write -> trigger -> outbox -> listener -> router -> real sockets", () => {
    let http: HttpServer;
    let base: string;
    let listener: OutboxListener;
    const sockets: Socket[] = [];
    const exp = () => Math.floor(Date.now() / 1000) + 300;

    beforeAll(async () => {
      const rt = await import("@/lib/realtime.server");
      http = createServer();
      rt.attachRealtime(http);
      await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
      base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
      const batcher = new EntityEventBatcher({ emit: rt.emitToRooms, windowMs: 20 });
      listener = new OutboxListener({
        createClient: () => new Client({ connectionString: dbUrl }) as unknown as ListenClient,
        deliver: (m) => batcher.push({ ...m.keys, table: m.table, op: m.op, id: m.row_id } as EntityMessage),
        onGap: () => {},
        error: () => {},
        log: () => {},
      });
      listener.start();
      await until(() => listener.status().connected, 5000, "e2e listener");
    });
    afterAll(async () => {
      sockets.forEach((s) => s.close());
      await listener.stop();
      await new Promise((r) => http.close(r));
    });

    const person = async (sub: string) => {
      const s = connect(base, { path: "/socket.io", auth: { token: `${sub}:${exp()}` }, transports: ["websocket"], reconnection: false });
      sockets.push(s);
      const got: Array<{ table: string; new: Record<string, unknown>; old: Record<string, unknown> }> = [];
      s.on("entity:changed", (p) => got.push(p));
      await new Promise((r) => s.once("connect", r));
      return { got };
    };

    it("members get only their own work; managers get what they may see; once each", async () => {
      // user ids double as socket subjects here: the room is user:<sub>
      const alice = await person(U.alice);
      const bob = await person(U.bob);
      const rita = await person(U.rita);
      const mgr = await person("mgr");
      const boss = await person("boss");
      await wait(150);

      // realistic writes, as the app / PostgREST would make them
      const t = (await q("INSERT INTO tasks (assigned_to, reviewer) VALUES ($1,$2) RETURNING id", [U.alice, U.rita])).rows[0].id;
      await q("INSERT INTO task_reviewers VALUES ($1,$2)", [t, U.rita]);
      await q("INSERT INTO leaves (user_id) VALUES ($1)", [U.alice]);
      await q("INSERT INTO task_worklogs (task_id, user_id) VALUES ($1,$2)", [t, U.alice]);
      await q("INSERT INTO nudges (user_id) VALUES ($1)", [U.bob]);
      await q("INSERT INTO risk_events (entity_type, entity_id) VALUES ('task',$1)", [t]);
      await wait(600);

      const tables = (c: { got: Array<{ table: string }> }) => [...new Set(c.got.map((g) => g.table))].sort();
      expect(tables(alice)).toEqual(["leaves", "task_worklogs", "tasks"]);
      expect(tables(rita)).toEqual(["tasks"]); // reviewer: the task only, not alice's leave or hours
      expect(tables(bob)).toEqual(["nudges"]); // unrelated member: only his own nudge
      expect(tables(mgr)).toEqual(["leaves", "risk_events", "task_worklogs", "tasks"]);
      expect(tables(boss)).toEqual(["leaves", "risk_events", "task_worklogs", "tasks"]);
      // each change delivered once per socket
      expect(alice.got.filter((g) => g.table === "tasks" && g.new.id === t)).toHaveLength(1);
      expect(JSON.stringify([alice.got, bob.got, mgr.got])).not.toMatch(/task_name|secret title/);
    });
  });

  describe("rollback migration", () => {
    it("removes every trigger/function/table; writes keep working; re-applying the migration restores events", async () => {
      await q(read(ROLLBACK));
      expect((await q("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'trg\\_realtime\\_%'")).rows[0].n).toBe(0);
      expect((await q("SELECT to_regclass('realtime.outbox') AS t")).rows[0].t).toBeNull();
      expect((await q("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'realtime'")).rows[0].n).toBe(0);
      await q("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]); // application writes are unaffected
      await q(read(ROLLBACK)); // idempotent
      await q(read(MIGRATION));
      await q(read(REMOVE_AUTOMATION));
      await q("INSERT INTO tasks (assigned_to) VALUES ($1)", [U.alice]);
      expect(await outbox()).toHaveLength(1);
    });
  });
});

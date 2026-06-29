/**
 * Lightweight Supabase client mock. Each test resets queues and asserts.
 *
 * Usage:
 *   mockSupabase.queueResponse("select", { data: [...] });
 *   mockSupabase.queueResponse("insert", { data: { id: "x" } });
 *   // call service
 *   expect(mockSupabase.calls.from).toContain("tasks");
 *
 * The mock returns a thenable chained builder that resolves to whatever was
 * queued for the terminal operation (select/insert/update/delete/upsert/rpc).
 * Chain methods like .eq, .gte, .order, .single, .maybeSingle, .is, .lt,
 * .neq, .not, .gte, .lte all return the same builder. `single()` /
 * `maybeSingle()` set a flag that affects the resolved shape only by
 * convention — the test is in charge of queueing the right shape.
 */
import { vi } from "vitest";

type Op = "select" | "insert" | "update" | "delete" | "upsert" | "rpc" | "storage";

interface Queued {
  op: Op;
  data?: unknown;
  error?: { message: string } | null;
}

class Builder {
  table: string;
  op: Op = "select";
  payload: unknown = undefined;
  filters: Array<{ method: string; args: unknown[] }> = [];
  constructor(table: string, private store: MockSupabase) { this.table = table; }
  select(cols?: string) { this.op = this.op === "select" ? "select" : this.op; void cols; return this; }
  insert(payload: unknown) { this.op = "insert"; this.payload = payload; this.store._record("insert", this.table, payload); return this; }
  update(payload: unknown) { this.op = "update"; this.payload = payload; this.store._record("update", this.table, payload); return this; }
  upsert(payload: unknown, _opts?: unknown) { this.op = "upsert"; this.payload = payload; this.store._record("upsert", this.table, payload); return this; }
  delete() { this.op = "delete"; this.store._record("delete", this.table, null); return this; }
  // chainable filters/sort — captured for assertions
  eq(c: string, v: unknown) { this.filters.push({ method: "eq", args: [c, v] }); return this; }
  neq(c: string, v: unknown) { this.filters.push({ method: "neq", args: [c, v] }); return this; }
  is(c: string, v: unknown) { this.filters.push({ method: "is", args: [c, v] }); return this; }
  not(c: string, op: string, v: unknown) { this.filters.push({ method: "not", args: [c, op, v] }); return this; }
  lt(c: string, v: unknown) { this.filters.push({ method: "lt", args: [c, v] }); return this; }
  lte(c: string, v: unknown) { this.filters.push({ method: "lte", args: [c, v] }); return this; }
  gte(c: string, v: unknown) { this.filters.push({ method: "gte", args: [c, v] }); return this; }
  order(c: string, opts?: unknown) { this.filters.push({ method: "order", args: [c, opts] }); return this; }
  limit(n: number) { this.filters.push({ method: "limit", args: [n] }); return this; }
  single() { this.filters.push({ method: "single", args: [] }); return this; }
  maybeSingle() { this.filters.push({ method: "maybeSingle", args: [] }); return this; }
  // resolves with queued response for this op
  then<T1, T2 = never>(
    onFulfilled?: (v: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>,
    onRejected?: (r: unknown) => T2 | PromiseLike<T2>,
  ): Promise<T1 | T2> {
    const queued = this.store._next(this.op);
    const result = { data: queued?.data ?? null, error: queued?.error ?? null };
    return Promise.resolve(result).then(onFulfilled, onRejected);
  }
}

class MockSupabase {
  private queues: Record<Op, Queued[]> = { select: [], insert: [], update: [], delete: [], upsert: [], rpc: [], storage: [] };
  calls: { from: string[]; rpc: string[]; ops: Array<{ op: Op; table: string; payload: unknown }>; storage: Array<{ op: string; bucket: string; path: string }> } = { from: [], rpc: [], ops: [], storage: [] };
  channelSubs: Array<{ name: string }> = [];

  queueResponse(op: Op, response: { data?: unknown; error?: { message: string } | null }) {
    this.queues[op].push({ op, ...response });
  }

  _next(op: Op): Queued | undefined { return this.queues[op].shift(); }
  _record(op: Op, table: string, payload: unknown) { this.calls.ops.push({ op, table, payload }); }

  from(table: string) {
    this.calls.from.push(table);
    return new Builder(table, this);
  }

  rpc(name: string, _args?: unknown) {
    this.calls.rpc.push(name);
    const queued = this._next("rpc");
    return Promise.resolve({ data: queued?.data ?? null, error: queued?.error ?? null });
  }

  channel(name: string) {
    this.channelSubs.push({ name });
    return {
      on() { return this; },
      subscribe() { return this; },
    };
  }
  removeChannel = vi.fn();

  storage = {
    from: vi.fn((bucket: string) => ({
      upload: vi.fn(async (path: string, _file: unknown) => {
        this.calls.storage.push({ op: "upload", bucket, path });
        const q = this._next("storage");
        return { data: q?.data ?? { path }, error: q?.error ?? null };
      }),
      remove: vi.fn(async (paths: string[]) => {
        this.calls.storage.push({ op: "remove", bucket, path: paths.join(",") });
        const q = this._next("storage");
        return { data: q?.data ?? null, error: q?.error ?? null };
      }),
      createSignedUrl: vi.fn(async (path: string) => {
        this.calls.storage.push({ op: "sign", bucket, path });
        const q = this._next("storage");
        return { data: q?.data ?? { signedUrl: `https://example/${path}` }, error: q?.error ?? null };
      }),
    })),
  };

  auth = {
    signOut: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  };

  reset() {
    (Object.keys(this.queues) as Op[]).forEach((k) => { this.queues[k] = []; });
    this.calls = { from: [], rpc: [], ops: [], storage: [] };
    this.channelSubs = [];
  }
}

export const mockSupabase = new MockSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: mockSupabase,
}));

// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const setMode = (v: string | undefined) => {
  if (v === undefined) delete process.env.OPERON_READ_ONLY;
  else process.env.OPERON_READ_ONLY = v;
};
afterEach(() => { setMode(undefined); vi.restoreAllMocks(); });

// ---- real Postgres: only runs when SCRATCH_PG_URL points at a DISPOSABLE database ----
const scratch = process.env.SCRATCH_PG_URL;
describe.skipIf(!scratch)("read-only pool against a real (scratch) Postgres", () => {
  it("SELECT and LISTEN work; INSERT, DDL and trigger install are rejected by Postgres itself", async () => {
    vi.resetModules();
    process.env.DATABASE_URL = scratch!;
    setMode("1");
    const { getPool } = await import("@/integrations/postgres/client.server");
    const pool = getPool();
    try {
      expect((await pool.query("select 1 as one")).rows[0].one).toBe(1);
      const c = await pool.connect();
      await c.query("LISTEN new_notification");
      await c.query("LISTEN entity_changed");
      c.release();
      await expect(pool.query("create table ro_probe (x int)")).rejects.toThrow(/read-only transaction/);
      await expect(pool.query("insert into notifications (user_id,type,title) values (gen_random_uuid(),'x','x')")).rejects.toThrow(/read-only|violates|permission|foreign/i);
      await expect(
        pool.query("create or replace function public.ro_probe() returns int language sql as 'select 1'"),
      ).rejects.toThrow(/read-only transaction/);
      await expect(pool.query("drop trigger if exists trg_notification_inserted on public.notifications")).rejects.toThrow(/read-only transaction/);
      expect((await pool.query("show default_transaction_read_only")).rows[0].default_transaction_read_only).toBe("on");
    } finally {
      await pool.end();
    }
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setMode = (v: string | undefined) => {
  if (v === undefined) delete process.env.OPERON_READ_ONLY;
  else process.env.OPERON_READ_ONLY = v;
};
afterEach(() => { setMode(undefined); vi.restoreAllMocks(); });

describe("Postgres pool", () => {
  const poolCfg = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
  vi.mock("pg", () => ({
    Pool: class {
      constructor(cfg: Record<string, unknown>) {
        poolCfg.last = cfg;
      }
    },
  }));
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://u:p@localhost:5433/db";
    vi.resetModules();
    poolCfg.last = null;
  });

  it("read-only mode: every session starts read-only and is labelled", async () => {
    setMode("1");
    const { getPool } = await import("@/integrations/postgres/client.server");
    getPool();
    expect(poolCfg.last).toMatchObject({
      options: "-c default_transaction_read_only=on",
      application_name: "operon-local-readonly",
    });
  });

  it("normal mode: pool config is exactly as before (no read-only option)", async () => {
    setMode(undefined);
    const { getPool } = await import("@/integrations/postgres/client.server");
    getPool();
    expect(poolCfg.last).not.toHaveProperty("options");
    expect(poolCfg.last).not.toHaveProperty("application_name");
  });
});


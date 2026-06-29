/**
 * Direct PostgreSQL connection pool — server-only.
 *
 * Replaces the Supabase JS client for all data-tier operations. Auth
 * (login, sessions, JWT verification) still uses Supabase; this pool is
 * for raw SQL access only.
 *
 * Connection string is read from DATABASE_URL at first use, NOT module
 * load, so the client bundle stays free of secrets and SSR prerender
 * does not crash when the var is absent during build.
 */
import { Pool, type PoolConfig } from "pg";

let _pool: Pool | undefined;

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Configure the Postgres connection string for the self-hosted database.",
    );
  }
  const config: PoolConfig = {
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Self-hosted Postgres behind Caddy/Docker on the same VM — TLS is
    // typically terminated at the proxy. Override via PG_SSL=true for
    // managed providers that require SSL.
    ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  };
  return new Pool(config);
}

export function getPool(): Pool {
  if (!_pool) _pool = createPool();
  return _pool;
}

/** Test-only hook to reset the pool between integration tests. */
export async function __resetPoolForTests(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
}

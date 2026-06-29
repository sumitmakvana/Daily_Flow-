/**
 * Query helpers — server-only.
 *
 * Two execution modes:
 *
 *   withUser(userId, fn)  → opens a transaction, sets request.jwt.claim.sub
 *                           and role='authenticated' via SET LOCAL, so the
 *                           102 RLS policies and 14 auth.uid()-based
 *                           functions continue to enforce ownership.
 *
 *   adminQuery(sql, args) → bypasses RLS (no role switch). Use only from
 *                           verified cron/webhook handlers — same trust
 *                           level as the former supabaseAdmin client.
 */
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { getPool } from "./client.server";

export type SqlArgs = ReadonlyArray<unknown>;

/**
 * Run a callback inside a transaction with the JWT claim set so RLS
 * policies see the request as coming from `userId`. Commits on success,
 * rolls back on any thrown error.
 */
export async function withUser<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // set_config is parameterised; SET LOCAL cannot bind parameters.
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("SET LOCAL role = 'authenticated'");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback failures */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Convenience wrapper for a single SELECT under a user context. Returns
 * the rows array directly.
 */
export async function selectAsUser<R extends QueryResultRow = QueryResultRow>(
  userId: string,
  sql: string,
  args: SqlArgs = [],
): Promise<R[]> {
  return withUser(userId, async (client) => {
    const res = await client.query<R>(sql, args as unknown[]);
    return res.rows;
  });
}

/** Admin / privileged query. Bypasses RLS. Use only after authorization. */
export async function adminQuery<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  args: SqlArgs = [],
): Promise<QueryResult<R>> {
  const pool = getPool();
  return pool.query<R>(sql, args as unknown[]);
}

/** Admin SELECT returning rows. */
export async function adminSelect<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  args: SqlArgs = [],
): Promise<R[]> {
  const res = await adminQuery<R>(sql, args);
  return res.rows;
}

/**
 * Server-side read-only mode (OPERON_READ_ONLY=1), for running the app locally
 * against a database you must not change (e.g. through an SSH tunnel to
 * production). It is opt-in and off by default, so deployed behaviour is
 * unchanged.
 *
 * When on:
 *  - every Postgres session opened by the server pool is read-only at the
 *    database level (default_transaction_read_only=on), so ANY write the server
 *    attempts is rejected by Postgres itself;
 *  - the background cron ticker is not started (it inserts notifications, sends
 *    email and calls the digest hooks);
 *  - the notification listener skips its startup DDL and never dispatches email;
 *    it keeps LISTENing (read-only) and still pushes Socket.IO events;
 *  - outbound HTTP writes (PostgREST, storage, email APIs) are refused.
 */
import { createReadOnlyFetch } from "@/lib/read-only-fetch";

export const READ_ONLY_PG_OPTIONS = "-c default_transaction_read_only=on";

export function isReadOnlyMode(): boolean {
  const v = process.env.OPERON_READ_ONLY?.trim().toLowerCase();
  return v === "1" || v === "true";
}

const g = globalThis as unknown as { __operonReadOnlyInstalled?: boolean };

/** Refuse non-GET outbound HTTP (except to this app's own loopback origin). Idempotent. */
export function installReadOnlyGuards(): void {
  if (g.__operonReadOnlyInstalled) return;
  g.__operonReadOnlyInstalled = true;

  const port = process.env.PORT || "8080";
  const allowHosts = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  globalThis.fetch = createReadOnlyFetch(globalThis.fetch.bind(globalThis), {
    allowHosts,
    onBlock: (method, url) =>
      console.warn(`[ReadOnly] blocked outbound ${method} ${url.replace(/\?.*$/, "")}`),
  });

  console.warn(
    "[ReadOnly] OPERON_READ_ONLY is ON: database sessions are read-only, cron ticker and " +
      "email dispatch are disabled, listener DDL is skipped, outbound HTTP writes are blocked.",
  );
}

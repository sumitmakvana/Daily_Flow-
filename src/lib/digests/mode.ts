/**
 * How a digest run was started:
 *  - "cron":      the HTTP hook was called by an external scheduler; the run checks the configured time and the
 *                 working day itself and returns "skipped" when it is not due.
 *  - "scheduled": the in-app CronTicker already matched the time and the working day; idempotency still applies.
 *  - "force":     an authenticated manual re-run outside the configured time (the previous `?force=true`).
 */
export type DigestMode = "cron" | "scheduled" | "force";

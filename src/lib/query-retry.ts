// React Query's default is "retry any failure 3 times". For an error that cannot succeed on a second
// try (not signed in, not allowed, a bad request, a missing column) every retry is a wasted request
// that fails the same way. Only transient failures (network, timeouts, 5xx, rate limits) are retried,
// and at most twice.

const PERMANENT_MESSAGE =
  /unauthor|forbidden|permission denied|not allowed|not authorized|jwt|does not exist|violates|invalid input|syntax error/i;

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown }; message?: unknown } | null;
  const status = [e?.status, e?.statusCode, e?.response?.status].find((s): s is number => typeof s === "number");
  if (status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  if (typeof e?.message === "string" && PERMANENT_MESSAGE.test(e.message)) return false;
  return failureCount < 2;
}

/**
 * Read-only HTTP guard, shared by the browser and the Node server.
 *
 * In read-only mode every outbound request that is not a safe method (GET, HEAD,
 * OPTIONS) is refused with a 403 before it leaves the process, except requests
 * to explicitly allowed hosts (the app's own loopback origin on the server).
 * This stops writes that go through PostgREST, storage, email APIs or any other
 * HTTP service, independent of the database-level read-only session.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const READ_ONLY_STATUS_TEXT = "Blocked by read-only mode";

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  const m = init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");
  return m.toUpperCase();
}

function hostOf(input: RequestInfo | URL): string | null {
  try {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    return new URL(raw, "http://relative.invalid").host;
  } catch {
    return null;
  }
}

export function createReadOnlyFetch(
  base: typeof fetch,
  opts: { allowHosts?: string[]; onBlock?: (method: string, url: string) => void } = {},
): typeof fetch {
  const allow = new Set((opts.allowHosts ?? []).map((h) => h.toLowerCase()));
  const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = methodOf(input, init);
    if (!SAFE_METHODS.has(method)) {
      const host = hostOf(input);
      // Unknown/unparseable target: refuse. Known and allow-listed: let it through.
      if (host === null || !allow.has(host.toLowerCase())) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
        opts.onBlock?.(method, url);
        return new Response(
          JSON.stringify({ message: READ_ONLY_STATUS_TEXT, code: "READ_ONLY_MODE", method }),
          { status: 403, statusText: READ_ONLY_STATUS_TEXT, headers: { "content-type": "application/json" } },
        );
      }
    }
    return base(input, init);
  }) as typeof fetch;
  return guarded;
}

/** True when the browser bundle was built with VITE_OPERON_READ_ONLY=1. */
export function isClientReadOnly(): boolean {
  try {
    return import.meta.env?.VITE_OPERON_READ_ONLY === "1";
  } catch {
    return false;
  }
}

import "./lib/error-capture";
import { startBackgroundCronTicker } from "./lib/cron-ticker.server";
import { startNotificationListener } from "./lib/notification-listener.server";
import { attachRealtime } from "./lib/realtime.server";
import { installReadOnlyGuards, isReadOnlyMode } from "./lib/read-only-mode.server";
import { pokeEntityWatcher, startEntityWatcher } from "./lib/entity-watcher.server";

// Start internal 60-second EOD cron loop and notification listener automatically in Node server process.
// In read-only mode (local run against a database that must not change) the cron
// ticker is NOT started and the listener runs without DDL or email dispatch.
if (isReadOnlyMode()) {
  installReadOnlyGuards();
} else {
  startBackgroundCronTicker();
}
startNotificationListener();
// Detects task/nudge/risk/suggestion/approval changes with read-only SELECTs when
// the database cannot push them (no triggers). Safe in read-only mode.
void startEntityWatcher().catch((err) => console.error("[EntityWatcher] failed to start:", err));

// runner.js owns the HTTP server (PORT 8080 in the container, 7050 on the host).
// It calls this hook once the bundle is loaded so Socket.IO shares that server
// and port instead of opening its own.
(globalThis as unknown as { __attachRealtime?: typeof attachRealtime }).__attachRealtime =
  attachRealtime;

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      // Any write request this server just handled (server functions, API hooks,
      // actions) may have changed tasks etc.: have the watcher look right away.
      if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
        pokeEntityWatcher();
      }
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },
};

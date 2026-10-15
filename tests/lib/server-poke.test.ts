// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  poke: vi.fn(),
  start: vi.fn(async () => null),
  handlerFetch: vi.fn(async () => new Response("ok", { status: 200 })),
}));

vi.mock("../../src/lib/error-capture", () => ({ consumeLastCapturedError: () => null }));
vi.mock("../../src/lib/error-page", () => ({ renderErrorPage: () => "error page" }));
vi.mock("../../src/lib/cron-ticker.server", () => ({ startBackgroundCronTicker: vi.fn() }));
vi.mock("../../src/lib/notification-listener.server", () => ({ startNotificationListener: vi.fn() }));
vi.mock("../../src/lib/realtime.server", () => ({ attachRealtime: vi.fn() }));
vi.mock("../../src/lib/entity-watcher.server", () => ({
  pokeEntityWatcher: () => h.poke(),
  startEntityWatcher: () => h.start(),
}));
vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: (...a: unknown[]) => (h.handlerFetch as (...x: unknown[]) => unknown)(...a) } }));

let server: { fetch: (r: Request, e?: unknown, c?: unknown) => Promise<Response> };

beforeEach(async () => {
  vi.resetModules();
  h.poke.mockClear();
  h.start.mockClear();
  h.handlerFetch.mockReset();
  h.handlerFetch.mockResolvedValue(new Response("ok", { status: 200 }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.OPERON_READ_ONLY;
  server = (await import("../../src/server")).default as never;
});
afterEach(() => vi.restoreAllMocks());

const req = (method: string) => new Request("http://localhost:7050/_serverFn/x", { method, body: method === "GET" || method === "HEAD" ? undefined : "{}" });

describe("server.ts: change check after write requests", () => {
  it("starts the change watcher at startup", () => {
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s pokes the watcher after the request is handled", async (m) => {
    const res = await server.fetch(req(m));
    expect(res.status).toBe(200);
    expect(h.poke).toHaveBeenCalledTimes(1);
  });

  it.each(["GET", "HEAD", "OPTIONS"])("%s does not poke (reads cannot change data)", async (m) => {
    await server.fetch(req(m));
    expect(h.poke).not.toHaveBeenCalled();
  });

  it("a failing write request (5xx/throw) still gets the normal error handling and does not poke-crash", async () => {
    h.handlerFetch.mockRejectedValueOnce(new Error("boom"));
    const res = await server.fetch(req("POST"));
    expect(res.status).toBe(500); // branded error page, as before
  });

  it("the poke happens AFTER the handler finished (the write is committed first)", async () => {
    const order: string[] = [];
    h.handlerFetch.mockImplementationOnce(async () => {
      order.push("handler");
      return new Response("ok");
    });
    h.poke.mockImplementationOnce(() => order.push("poke"));
    await server.fetch(req("POST"));
    expect(order).toEqual(["handler", "poke"]);
  });
});

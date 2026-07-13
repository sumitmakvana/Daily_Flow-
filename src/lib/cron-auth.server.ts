/**
 * Cron auth, rate-limit, and replay protection.
 *
 * Required request headers from pg_cron:
 *   x-cron-secret    — shared CRON_SECRET
 *   x-cron-timestamp — ISO timestamp (now())
 *   x-cron-nonce     — gen_random_uuid() per invocation
 *
 * Verified atomically by inserting (nonce, route, ts) into public.cron_invocations:
 *  - duplicate nonce ⇒ replay
 *  - rows within 30s for the same route ⇒ rate-limited
 *  - ts > 5 min skew ⇒ expired
 *
 * Returns null on success, or a 401/429 Response on failure.
 */
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SKEW_MS = 5 * 60 * 1000; // ±5 min
const RATE_WINDOW_MS = 30 * 1000; // 30s per route

function safeEq(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function requireCronAuth(
  request: Request,
  route: string,
): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not configured", { status: 500 });

  const headerSecret = request.headers.get("x-cron-secret") ?? "";
  const headerTs = request.headers.get("x-cron-timestamp") ?? "";
  const headerNonce = request.headers.get("x-cron-nonce") ?? "";

  if (!headerSecret || !safeEq(headerSecret, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const tsMs = Date.parse(headerTs);
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > SKEW_MS) {
    return new Response("Stale or invalid timestamp", { status: 401 });
  }
  if (!headerNonce || headerNonce.length < 16) {
    return new Response("Invalid nonce", { status: 401 });
  }

  // Rate limit: any successful invocation for the same route within the window blocks.
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await supabaseAdmin
    .from("cron_invocations")
    .select("nonce", { head: true, count: "exact" })
    .eq("route", route)
    .gte("ts", since);
  if ((count ?? 0) > 0) {
    return new Response("Rate limited", { status: 429 });
  }

  // Replay protection: PK on nonce ⇒ second insert fails with 23505.
  const { error } = await supabaseAdmin.from("cron_invocations").insert({
    nonce: headerNonce,
    route,
    ts: new Date(tsMs).toISOString(),
  });
  if (error) {
    console.error("[cron-auth] Insert failed. Properties:", Object.getOwnPropertyNames(error), "Payload:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    if (error.code === "23505") return new Response("Replay detected", { status: 401 });
    return new Response("Auth store error", { status: 500 });
  }

  // Best-effort GC of old invocations (>24h).
  void supabaseAdmin
    .from("cron_invocations")
    .delete()
    .lt("ts", new Date(Date.now() - 86_400_000).toISOString());

  return null;
}

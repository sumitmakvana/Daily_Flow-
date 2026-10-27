/**
 * Signed, short-lived, single-purpose tokens for notification action buttons (server-only).
 *
 * A token is minted when a push is sent and is delivered only inside that push's payload, so
 * possessing it proves the push reached the recipient's device. It binds user + task + action and
 * expires; the endpoint that redeems it still re-checks assignment and task status.
 *
 * Key: PUSH_ACTION_SECRET, falling back to CRON_SECRET (domain-separated). Without either, no
 * action buttons are issued.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type PushAction = "start";

export interface PushActionClaims {
  /** user id the action is for */
  u: string;
  /** task id */
  t: string;
  a: PushAction;
  /** expiry, unix seconds */
  exp: number;
  /** unique id (used for one-time redemption) */
  jti: string;
}

const TTL_SECONDS = 24 * 60 * 60;

function key(): Buffer | null {
  const secret = process.env.PUSH_ACTION_SECRET || process.env.CRON_SECRET;
  if (!secret) return null;
  return createHmac("sha256", "operon-push-action:v1").update(secret).digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function isActionSigningConfigured(): boolean {
  return key() !== null;
}

export function signPushAction(userId: string, taskId: string, action: PushAction): string | null {
  const k = key();
  if (!k) return null;
  const claims: PushActionClaims = {
    u: userId,
    t: taskId,
    a: action,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
    jti: randomUUID(),
  };
  const body = b64(JSON.stringify(claims));
  const sig = b64(createHmac("sha256", k).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyPushAction(token: unknown): PushActionClaims | null {
  const k = key();
  if (!k || typeof token !== "string" || token.length > 1024) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = createHmac("sha256", k).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PushActionClaims;
    if (c.a !== "start" || typeof c.u !== "string" || typeof c.t !== "string") return null;
    if (typeof c.jti !== "string" || typeof c.exp !== "number") return null;
    if (c.exp < Math.floor(Date.now() / 1000)) return null;
    return c;
  } catch {
    return null;
  }
}

// One-time redemption (per server process). The task-status check in the redeeming endpoint makes
// a replay after a restart harmless: a task that is already started is never started twice.
const redeemed = new Map<string, number>();

/** Returns true the first time a jti is seen, false on replay. */
export function markActionRedeemed(claims: PushActionClaims): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (const [id, exp] of redeemed) if (exp < now) redeemed.delete(id);
  if (redeemed.has(claims.jti)) return false;
  redeemed.set(claims.jti, claims.exp);
  return true;
}

/** Allow a retry after a transient failure (e.g. DB error) without burning the token. */
export function releaseAction(claims: PushActionClaims) {
  redeemed.delete(claims.jti);
}

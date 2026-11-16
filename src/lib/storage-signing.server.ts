/**
 * HMAC signing for the self-hosted file proxy (/app-storage/file).
 *
 * Key: STORAGE_SIGNING_SECRET, falling back to CRON_SECRET (the key used so far, so existing links keep
 * working). There is no fixed fallback string: without either variable a random per-process key is used,
 * so links stay unforgeable and simply stop working after a restart.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

let ephemeral: string | null = null;

function secret(): string {
  const s = process.env.STORAGE_SIGNING_SECRET || process.env.CRON_SECRET;
  if (s) return s;
  if (!ephemeral) {
    ephemeral = randomBytes(32).toString("hex");
    console.warn(
      "[storage] No STORAGE_SIGNING_SECRET or CRON_SECRET: using a per-process key; file links stop working on restart.",
    );
  }
  return ephemeral;
}

export function signStoragePath(path: string, expires: number): string {
  return createHmac("sha256", secret()).update(`${path}:${expires}`).digest("hex");
}

export function verifyStoragePath(path: string, expires: number, token: string): boolean {
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  const a = Buffer.from(signStoragePath(path, expires), "hex");
  const b = Buffer.from(token, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

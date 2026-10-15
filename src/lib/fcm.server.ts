/**
 * Firebase Cloud Messaging (HTTP v1) sender — server-only.
 *
 * Configure with ONE of:
 *   FCM_SERVICE_ACCOUNT_JSON  – the Firebase service-account JSON (string)
 *   FCM_SERVICE_ACCOUNT_FILE  – path to that JSON file
 * When neither is set, push is silently disabled (email/in-app keep working).
 */
import { readFileSync } from "node:fs";
import { getPool } from "@/integrations/postgres/client.server";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let account: ServiceAccount | null | undefined;
let cachedToken: { value: string; exp: number } | null = null;
let ensured = false;

function loadAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  try {
    const raw =
      process.env.FCM_SERVICE_ACCOUNT_JSON ||
      (process.env.FCM_SERVICE_ACCOUNT_FILE
        ? readFileSync(process.env.FCM_SERVICE_ACCOUNT_FILE, "utf8")
        : "");
    account = raw ? (JSON.parse(raw) as ServiceAccount) : null;
  } catch (e) {
    console.error("[FCM] Could not load service account:", (e as Error).message);
    account = null;
  }
  return account;
}

export function isPushConfigured(): boolean {
  return loadAccount() !== null;
}

export async function ensureDeviceTokensTable() {
  if (ensured) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS public.device_tokens (
      token text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      platform text NOT NULL DEFAULT 'android',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON public.device_tokens(user_id);
  `);
  ensured = true;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;

  const { SignJWT, importPKCS8 } = await import("jose");
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`FCM OAuth failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}

export interface PushMessage {
  title: string;
  body?: string | null;
  /** Delivered to the app; `task_id` / `url` drive the deep link on tap. */
  data?: Record<string, string | null | undefined>;
}

/** Send a push to every registered device of a user. Never throws. */
export async function sendPushToUser(userId: string, msg: PushMessage): Promise<void> {
  const sa = loadAccount();
  if (!sa) return;
  try {
    await ensureDeviceTokensTable();
    const pool = getPool();
    const { rows } = await pool.query<{ token: string }>(
      "SELECT token FROM public.device_tokens WHERE user_id = $1",
      [userId],
    );
    if (rows.length === 0) return;

    const accessToken = await getAccessToken(sa);
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(msg.data ?? {})) if (v) data[k] = String(v);

    await Promise.all(
      rows.map(async ({ token }) => {
        const res = await fetch(
          `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token,
                notification: { title: msg.title, body: msg.body ?? "" },
                data,
                android: { priority: "HIGH" },
              },
            }),
          },
        );
        if (res.ok) return;
        const text = await res.text();
        if (/UNREGISTERED|INVALID_ARGUMENT/.test(text)) {
          await pool.query("DELETE FROM public.device_tokens WHERE token = $1", [token]);
        } else {
          console.error("[FCM] send failed:", res.status, text);
        }
      }),
    );
  } catch (e) {
    console.error("[FCM] push error:", (e as Error).message);
  }
}

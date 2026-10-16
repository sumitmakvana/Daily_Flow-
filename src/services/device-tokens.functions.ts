import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import { getPool } from "@/integrations/postgres/client.server";
import { ensureDeviceTokensTable } from "@/lib/fcm.server";

const TokenSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(["android"]).default("android"),
});

/** Register (or re-assign) this device's FCM token to the signed-in user. */
export const registerDeviceTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => TokenSchema.parse(d))
  .handler(async ({ data, context }) => {
    console.log(
      "[push-diag] step4 register request authenticated; user=",
      context.userId,
      "tokenLength=",
      data.token.length,
    );
    try {
      await ensureDeviceTokensTable();
      // A shared device may previously have belonged to another account: take ownership.
      // (RLS only lets a user touch their own rows, so this runs on the pool.)
      await getPool().query("DELETE FROM public.device_tokens WHERE token = $1 AND user_id <> $2", [
        data.token,
        context.userId,
      ]);
      await withUser(context.userId, (client) =>
        client.query(
          `INSERT INTO public.device_tokens (token, user_id, platform)
         VALUES ($1, $2, $3)
         ON CONFLICT (token) DO UPDATE SET updated_at = now()`,
          [data.token, context.userId, data.platform],
        ),
      );
      console.log("[push-diag] step5 device token stored for user=", context.userId);
      return { ok: true };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      console.error("[push-diag] step5 FAIL insert; pg code=", err.code, "message=", err.message);
      throw e;
    }
  });

export const unregisterDeviceTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ token: z.string().min(20).max(4096) }).parse(d))
  .handler(async ({ data, context }) => {
    await ensureDeviceTokensTable();
    await withUser(context.userId, (client) =>
      client.query("DELETE FROM public.device_tokens WHERE token = $1 AND user_id = $2", [
        data.token,
        context.userId,
      ]),
    );
    return { ok: true };
  });

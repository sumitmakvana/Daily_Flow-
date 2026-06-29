import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { selectAsUser, withUser } from "@/integrations/postgres/query.server";
import type { Nudge } from "@/lib/types";

export const fetchActiveNudges = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) =>
    z.object({ userId: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    return selectAsUser<Nudge>(
      context.userId,
      `SELECT id, user_id, kind, title, body, severity, cooldown_until,
              created_at, read_at, dismissed_at
         FROM public.nudges
         WHERE user_id = $1
           AND dismissed_at IS NULL
         ORDER BY severity DESC, created_at DESC
         LIMIT 20`,
      [data.userId],
    );
  });

export const markNudgeRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.nudges SET read_at = now() WHERE id = $1`,
        [data.id],
      );
    });
    return { ok: true };
  });

export const dismissNudge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.nudges SET dismissed_at = now() WHERE id = $1`,
        [data.id],
      );
    });
    return { ok: true };
  });

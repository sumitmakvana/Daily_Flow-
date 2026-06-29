import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";

const KINDS = ["manual", "pre_install", "pre_import", "pre_restore"] as const;

const COLS = `id, kind, label, payload, created_by, created_at`;

export const listConfigSnapshotsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query(
        `SELECT ${COLS} FROM public.config_snapshots
           ORDER BY created_at DESC
           LIMIT 50`,
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const snapshotConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { label: string; kind: (typeof KINDS)[number] }) =>
      z
        .object({ label: z.string().min(1), kind: z.enum(KINDS) })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const id = await withUser(context.userId, async (client) => {
      const res = await client.query<{ snapshot_config: string }>(
        `SELECT public.snapshot_config($1, $2) AS snapshot_config`,
        [data.label, data.kind],
      );
      return res.rows[0].snapshot_config;
    });
    return { id };
  });

export const restoreConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { snapshotId: string }) =>
    z.object({ snapshotId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(`SELECT public.restore_config($1)`, [data.snapshotId]);
    });
    return { ok: true };
  });

export const deleteConfigSnapshotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `DELETE FROM public.config_snapshots WHERE id = $1`,
        [data.id],
      );
    });
    return { ok: true };
  });

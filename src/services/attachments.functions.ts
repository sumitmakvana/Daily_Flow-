import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import type { Attachment } from "@/lib/types";

/**
 * Attachment metadata server fns. Storage (Supabase Storage `work-item-files`
 * bucket) is out of scope for the DB migration and stays on the supabase-js
 * client — these server fns only manage the `public.attachments` table.
 */

export const listAttachmentsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workItemId: string }) =>
    z.object({ workItemId: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query<Attachment>(
        `SELECT id, work_item_id, file_name, file_size, file_type,
                storage_path, uploaded_by, uploaded_at
           FROM public.attachments
           WHERE work_item_id = $1
           ORDER BY uploaded_at DESC`,
        [data.workItemId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const insertAttachmentMetaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      workItemId: string;
      fileName: string;
      fileSize: number;
      fileType: string;
      storagePath: string;
    }) =>
      z
        .object({
          workItemId: z.string(),
          fileName: z.string(),
          fileSize: z.number().int().nonnegative(),
          fileType: z.string(),
          storagePath: z.string(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const row = await withUser(context.userId, async (client) => {
      // 1. Check if the row was already created by the upload step
      const existing = await client.query<Attachment>(
        `SELECT id, work_item_id, file_name, file_size, file_type,
                storage_path, uploaded_by, uploaded_at
         FROM public.attachments
         WHERE storage_path = $1`,
        [data.storagePath]
      );
      if (existing.rows.length > 0) {
        if (!existing.rows[0].uploaded_by && context.userId) {
          await client.query(
            `UPDATE public.attachments SET uploaded_by = $1 WHERE id = $2`,
            [context.userId, existing.rows[0].id]
          );
          existing.rows[0].uploaded_by = context.userId;
        }
        return existing.rows[0];
      }

      // 2. Otherwise insert a new row (e.g. for Supabase fallback mode)
      const res = await client.query<Attachment>(
        `INSERT INTO public.attachments
            (work_item_id, file_name, file_size, file_type, storage_path, uploaded_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, work_item_id, file_name, file_size, file_type,
                      storage_path, uploaded_by, uploaded_at`,
        [
          data.workItemId,
          data.fileName,
          data.fileSize,
          data.fileType,
          data.storagePath,
          context.userId,
        ],
      );
      return res.rows[0];
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const deleteAttachmentMetaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(`DELETE FROM public.attachments WHERE id = $1`, [data.id]);
    });
    return { ok: true };
  });

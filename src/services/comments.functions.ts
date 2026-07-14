import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withUser } from "@/integrations/postgres/query.server";
import type { Comment } from "@/lib/types";

export interface CommentWithMentionsRow extends Comment {
  mentions: string[];
}

export const listCommentsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workItemId: string }) =>
    z.object({ workItemId: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rows = await withUser(context.userId, async (client) => {
      const res = await client.query<CommentWithMentionsRow>(
        `SELECT c.id, c.work_item_id, c.parent_comment_id, c.user_id, c.body,
                c.created_at, c.edited_at, c.deleted_at,
                COALESCE(
                  (SELECT array_agg(m.mentioned_user_id)
                     FROM public.comment_mentions m
                     WHERE m.comment_id = c.id),
                  ARRAY[]::uuid[]
                ) AS mentions
           FROM public.comments c
           WHERE c.work_item_id = $1
           ORDER BY c.created_at ASC`,
        [data.workItemId],
      );
      return res.rows;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows as any;
  });

export const addCommentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      workItemId: string;
      body: string;
      parentId?: string | null;
      mentionUserIds?: string[];
    }) =>
      z
        .object({
          workItemId: z.string(),
          body: z.string(),
          parentId: z.string().nullable().optional(),
          mentionUserIds: z.array(z.string()).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const body = data.body.trim();
    if (!body) throw new Error("Comment cannot be empty");
    if (body.length > 4000) throw new Error("Comment too long");
    const row = await withUser(context.userId, async (client) => {
      const ins = await client.query<Comment>(
        `INSERT INTO public.comments (work_item_id, user_id, body, parent_comment_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, work_item_id, parent_comment_id, user_id, body,
                     created_at, edited_at, deleted_at`,
        [data.workItemId, context.userId, body, data.parentId ?? null],
      );
      const created = ins.rows[0];
      const mentions = Array.from(new Set(data.mentionUserIds ?? [])).filter(
        (u) => u !== context.userId,
      );
      let savedMentions = mentions;
      if (mentions.length > 0) {
        try {
          await client.query(
            `INSERT INTO public.comment_mentions (comment_id, mentioned_user_id)
               SELECT $1, unnest($2::uuid[])`,
            [created.id, mentions],
          );
        } catch (err) {
          // Best-effort: trigger fires notifications; failure shouldn't undo comment.
          console.warn("[comments.add] mention insert failed:", (err as Error).message);
          savedMentions = [];
        }
      }
      return { ...created, mentions: savedMentions };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const editCommentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { commentId: string; body: string }) =>
    z.object({ commentId: z.string(), body: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const t = data.body.trim();
    if (!t) throw new Error("Comment cannot be empty");
    if (t.length > 4000) throw new Error("Comment too long");
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.comments SET body = $1, edited_at = now() WHERE id = $2`,
        [t, data.commentId],
      );
    });
    return { ok: true };
  });

export const removeCommentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { commentId: string }) =>
    z.object({ commentId: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      await client.query(
        `UPDATE public.comments
            SET deleted_at = now(), body = '[deleted]'
          WHERE id = $1`,
        [data.commentId],
      );
    });
    return { ok: true };
  });

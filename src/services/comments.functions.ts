import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PoolClient } from "pg";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { adminSelect, withUser } from "@/integrations/postgres/query.server";
import type { Comment } from "@/lib/types";

export interface CommentWithMentionsRow extends Comment {
  mentions: string[];
}

export interface MentionableUser {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
}

const MAX_BODY = 50000;
const MAX_MENTIONS = 50;
const mentionIdsSchema = z.array(z.string().uuid()).max(MAX_MENTIONS).optional();

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

/**
 * Users offered by the @mention picker. Emails are hidden from normal
 * cross-user profile reads (column-level REVOKE), so this goes through the
 * server and returns active users only.
 */
export const listMentionableUsersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const rows = await adminSelect<MentionableUser>(
      `SELECT id,
              COALESCE(NULLIF(btrim(display_name), ''), split_part(email, '@', 1)) AS display_name,
              email, avatar_url
         FROM public.profiles
        WHERE COALESCE(is_active, true) = true
        ORDER BY 2`,
    );
    return rows;
  });

/** Drops self-mentions, duplicates and ids that are not active profiles. */
async function validMentionIds(
  client: PoolClient,
  authorId: string,
  requested: string[] | undefined,
): Promise<string[]> {
  const ids = Array.from(new Set(requested ?? [])).filter((u) => u !== authorId);
  if (ids.length === 0) return [];
  const res = await client.query<{ id: string }>(
    `SELECT id FROM public.profiles
      WHERE id = ANY($1::uuid[]) AND COALESCE(is_active, true) = true`,
    [ids],
  );
  const found = new Set(res.rows.map((r) => r.id));
  return ids.filter((id) => found.has(id));
}

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
          mentionUserIds: mentionIdsSchema,
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const body = data.body.trim();
    if (!body) throw new Error("Comment cannot be empty");
    if (body.length > MAX_BODY) throw new Error("Comment too long");
    const row = await withUser(context.userId, async (client) => {
      if (data.parentId) {
        const parent = await client.query(
          `SELECT 1 FROM public.comments WHERE id = $1 AND work_item_id = $2`,
          [data.parentId, data.workItemId],
        );
        if (parent.rows.length === 0) throw new Error("Parent comment not found");
      }
      const ins = await client.query<Comment>(
        `INSERT INTO public.comments (work_item_id, user_id, body, parent_comment_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, work_item_id, parent_comment_id, user_id, body,
                     created_at, edited_at, deleted_at`,
        [data.workItemId, context.userId, body, data.parentId ?? null],
      );
      const created = ins.rows[0];
      // Same transaction as the comment: a mention failure rolls the whole post
      // back (the client keeps the draft) instead of silently dropping the
      // notifications. The comment_mentions trigger creates the notifications.
      const mentions = await validMentionIds(client, context.userId, data.mentionUserIds);
      if (mentions.length > 0) {
        await client.query(
          `INSERT INTO public.comment_mentions (comment_id, mentioned_user_id)
             SELECT $1, unnest($2::uuid[])
           ON CONFLICT DO NOTHING`,
          [created.id, mentions],
        );
      }
      return { ...created, mentions };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return row as any;
  });

export const editCommentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { commentId: string; body: string; mentionUserIds?: string[] }) =>
    z
      .object({ commentId: z.string(), body: z.string(), mentionUserIds: mentionIdsSchema })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const t = data.body.trim();
    if (!t) throw new Error("Comment cannot be empty");
    if (t.length > MAX_BODY) throw new Error("Comment too long");
    const mentions = await withUser(context.userId, async (client) => {
      const upd = await client.query(
        `UPDATE public.comments SET body = $1, edited_at = now()
          WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL`,
        [t, data.commentId, context.userId],
      );
      if (upd.rowCount === 0) throw new Error("Comment not found or not editable");
      // Re-sync mentions only when the client sent a list. Existing rows are
      // kept (no duplicate notification); only newly added people are notified.
      if (data.mentionUserIds === undefined) return undefined;
      const next = await validMentionIds(client, context.userId, data.mentionUserIds);
      await client.query(
        `DELETE FROM public.comment_mentions
          WHERE comment_id = $1 AND NOT (mentioned_user_id = ANY($2::uuid[]))`,
        [data.commentId, next],
      );
      if (next.length > 0) {
        await client.query(
          `INSERT INTO public.comment_mentions (comment_id, mentioned_user_id)
             SELECT $1, unnest($2::uuid[])
           ON CONFLICT DO NOTHING`,
          [data.commentId, next],
        );
      }
      return next;
    });
    return { ok: true, mentions };
  });

export const removeCommentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { commentId: string }) =>
    z.object({ commentId: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await withUser(context.userId, async (client) => {
      const res = await client.query(
        `UPDATE public.comments
            SET deleted_at = now(), body = '[deleted]'
          WHERE id = $1 AND deleted_at IS NULL`,
        [data.commentId],
      );
      if (res.rowCount === 0) throw new Error("Comment not found or not allowed to delete");
    });
    return { ok: true };
  });

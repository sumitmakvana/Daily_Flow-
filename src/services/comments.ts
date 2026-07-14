/**
 * Comments service — threaded comments + @mentions on a work item.
 *
 * Now backed by TanStack server functions over the pg pool. The
 * `mention` notification trigger on `comment_mentions` continues to fire
 * because we still insert through the same SQL path under the caller's
 * RLS context.
 */
import type { Comment } from "@/lib/types";
import {
  listCommentsFn,
  addCommentFn,
  editCommentFn,
  removeCommentFn,
} from "./comments.functions";

export interface CommentWithMentions extends Comment {
  mentions: string[]; // user ids
}

export const commentsService = {
  async list(workItemId: string): Promise<CommentWithMentions[]> {
    return (await listCommentsFn({ data: { workItemId } })) as unknown as CommentWithMentions[];
  },

  async add(opts: {
    workItemId: string;
    userId: string; // kept for signature compatibility; server uses authenticated context
    body: string;
    parentId?: string | null;
    mentionUserIds?: string[];
  }): Promise<CommentWithMentions> {
    void opts.userId;
    return (await addCommentFn({
      data: {
        workItemId: opts.workItemId,
        body: opts.body,
        parentId: opts.parentId ?? null,
        mentionUserIds: opts.mentionUserIds,
      },
    })) as unknown as CommentWithMentions;
  },

  async edit(commentId: string, body: string): Promise<void> {
    await editCommentFn({ data: { commentId, body } });
  },

  async remove(commentId: string): Promise<void> {
    await removeCommentFn({ data: { commentId } });
  },
};

/** Extract `@token` substrings from a body. */
export function extractMentionTokens(body: string): string[] {
  const matches = body.matchAll(/@([\w.\-]{2,40})/g);
  return Array.from(new Set(Array.from(matches, (m) => m[1])));
}

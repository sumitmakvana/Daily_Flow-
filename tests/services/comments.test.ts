import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Stateful stand-in for the comments / comment_mentions / notifications tables.
 * withUser() snapshots state and restores it on a throw (real transaction
 * rollback) and inserting a mention fires the same notification the
 * on_comment_mention() trigger does (skip author, dedupe by key).
 */
const db = vi.hoisted(() => {
  const state = {
    comments: [] as any[],
    mentions: [] as Array<{ comment_id: string; mentioned_user_id: string }>,
    notifications: [] as Array<{ user_id: string; type: string; body: string; dedupe_key: string }>,
    profiles: [] as Array<{ id: string; display_name: string; email: string; avatar_url: null; is_active: boolean }>,
    seq: 0,
    failMentionInsert: false,
  };
  return state;
});

vi.mock("@/integrations/postgres/query.server", () => {
  const client = {
    async query(sql: string, params: any[] = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (/^SELECT 1 FROM public\.comments WHERE id = \$1 AND work_item_id = \$2/.test(s)) {
        const rows = db.comments.filter((c) => c.id === params[0] && c.work_item_id === params[1]);
        return { rows: rows.map(() => ({ "?column?": 1 })), rowCount: rows.length };
      }
      if (/^INSERT INTO public\.comments /.test(s)) {
        const [work_item_id, user_id, body, parent_comment_id] = params;
        const row = {
          id: `c${++db.seq}`, work_item_id, parent_comment_id, user_id, body,
          created_at: "now", edited_at: null, deleted_at: null,
        };
        db.comments.push(row);
        return { rows: [{ ...row }], rowCount: 1 };
      }
      if (/^SELECT id FROM public\.profiles/.test(s)) {
        const rows = db.profiles.filter((p) => params[0].includes(p.id) && p.is_active).map((p) => ({ id: p.id }));
        return { rows, rowCount: rows.length };
      }
      if (/^INSERT INTO public\.comment_mentions/.test(s)) {
        if (db.failMentionInsert) throw new Error("mention insert failed");
        const [commentId, ids] = params as [string, string[]];
        for (const uid of ids) {
          if (db.mentions.some((m) => m.comment_id === commentId && m.mentioned_user_id === uid)) continue;
          db.mentions.push({ comment_id: commentId, mentioned_user_id: uid });
          const c = db.comments.find((x) => x.id === commentId)!;
          const key = `MENTION_${commentId}_${uid}`;
          if (c.user_id !== uid && !db.notifications.some((n) => n.dedupe_key === key)) {
            db.notifications.push({ user_id: uid, type: "mention", body: c.body.slice(0, 240), dedupe_key: key });
          }
        }
        return { rows: [], rowCount: ids.length };
      }
      if (/^DELETE FROM public\.comment_mentions/.test(s)) {
        const [commentId, keep] = params as [string, string[]];
        const before = db.mentions.length;
        db.mentions = db.mentions.filter((m) => m.comment_id !== commentId || keep.includes(m.mentioned_user_id));
        return { rows: [], rowCount: before - db.mentions.length };
      }
      if (/^UPDATE public\.comments SET body = \$1, edited_at = now\(\) WHERE id = \$2 AND user_id = \$3 AND deleted_at IS NULL/.test(s)) {
        const c = db.comments.find((x) => x.id === params[1] && x.user_id === params[2] && !x.deleted_at);
        if (c) { c.body = params[0]; c.edited_at = "now"; }
        return { rows: [], rowCount: c ? 1 : 0 };
      }
      if (/^UPDATE public\.comments SET deleted_at = now\(\), body = '\[deleted\]' WHERE id = \$1 AND deleted_at IS NULL/.test(s)) {
        const c = db.comments.find((x) => x.id === params[0] && !x.deleted_at);
        if (c) { c.deleted_at = "now"; c.body = "[deleted]"; }
        return { rows: [], rowCount: c ? 1 : 0 };
      }
      if (/^SELECT c\.id, c\.work_item_id/.test(s)) {
        const rows = db.comments
          .filter((c) => c.work_item_id === params[0])
          .map((c) => ({
            ...c,
            mentions: db.mentions.filter((m) => m.comment_id === c.id).map((m) => m.mentioned_user_id),
          }));
        return { rows, rowCount: rows.length };
      }
      throw new Error(`unexpected SQL: ${s}`);
    },
  };
  return {
    withUser: async (_uid: string, fn: (c: typeof client) => Promise<unknown>) => {
      const snap = structuredClone({
        comments: db.comments, mentions: db.mentions, notifications: db.notifications,
      });
      try {
        return await fn(client);
      } catch (e) {
        db.comments = snap.comments;
        db.mentions = snap.mentions;
        db.notifications = snap.notifications;
        throw e;
      }
    },
    selectAsUser: async () => [],
    adminSelect: async () =>
      db.profiles.filter((p) => p.is_active).map(({ id, display_name, email, avatar_url }) => ({
        id, display_name, email, avatar_url,
      })),
  };
});

import { commentsService, extractMentionTokens } from "@/services/comments";

const ME = "00000000-0000-4000-8000-000000000001";
const NIRAV = "00000000-0000-4000-8000-000000000002";
const MIRAJ = "00000000-0000-4000-8000-000000000003";
const GONE = "00000000-0000-4000-8000-000000000004";
const STRANGER = "00000000-0000-4000-8000-000000000099";
const TASK = "t1";

describe("services/comments", () => {
  beforeEach(() => {
    db.comments = [];
    db.mentions = [];
    db.notifications = [];
    db.seq = 0;
    db.failMentionInsert = false;
    db.profiles = [
      { id: ME, display_name: "Sumit Makwana", email: "sumit@noesisanalytics.co.in", avatar_url: null, is_active: true },
      { id: NIRAV, display_name: "Nirav Thakkar", email: "nirav@noesisanalytics.co.in", avatar_url: null, is_active: true },
      { id: MIRAJ, display_name: "Miraj Shah", email: "miraj.shah@noesisanalytics.co.in", avatar_url: null, is_active: true },
      { id: GONE, display_name: "Left Company", email: "gone@noesisanalytics.co.in", avatar_url: null, is_active: false },
    ];
  });

  const add = (body: string, mentionUserIds?: string[], parentId?: string | null) =>
    commentsService.add({ workItemId: TASK, userId: ME, body, parentId, mentionUserIds });

  it("extractMentionTokens parses unique @handles", () => {
    expect(extractMentionTokens("hi @alice and @bob and @alice again")).toEqual(["alice", "bob"]);
    expect(extractMentionTokens("no mentions here")).toEqual([]);
  });

  describe("add", () => {
    it("rejects empty and oversize bodies", async () => {
      await expect(add("  ")).rejects.toThrow(/empty/);
      await expect(add("x".repeat(50001))).rejects.toThrow(/long/);
      expect(db.comments).toHaveLength(0);
    });

    it("accepts bodies past the old 4000 char cap", async () => {
      await expect(add("x".repeat(4001))).resolves.toBeTruthy();
    });

    it("persists multiple mentions and notifies each mentioned user once", async () => {
      const created = await add("@Nirav Thakkar @Miraj Shah please check", [NIRAV, MIRAJ]);
      expect(created.mentions.sort()).toEqual([NIRAV, MIRAJ].sort());
      expect(db.mentions).toHaveLength(2);
      expect(db.notifications.map((n) => n.user_id).sort()).toEqual([NIRAV, MIRAJ].sort());
      expect(db.notifications[0]).toMatchObject({ type: "mention", body: "@Nirav Thakkar @Miraj Shah please check" });
    });

    it("drops self-mentions, duplicates, inactive users and unknown ids", async () => {
      const created = await add("hi", [ME, NIRAV, NIRAV, GONE, STRANGER]);
      expect(created.mentions).toEqual([NIRAV]);
      expect(db.notifications.map((n) => n.user_id)).toEqual([NIRAV]);
    });

    it("posts without mentions and creates no notification", async () => {
      const created = await add("plain comment");
      expect(created.mentions).toEqual([]);
      expect(db.notifications).toHaveLength(0);
    });

    it("rolls the comment back if persisting mentions fails (so the client keeps the draft)", async () => {
      db.failMentionInsert = true;
      await expect(add("@Nirav Thakkar hi", [NIRAV])).rejects.toThrow(/mention insert failed/);
      expect(db.comments).toHaveLength(0);
      expect(db.notifications).toHaveLength(0);
    });

    it("threads replies and rejects a parent from another work item", async () => {
      const root = await add("root");
      const reply = await add("reply", [], root.id);
      expect(reply.parent_comment_id).toBe(root.id);
      await expect(
        commentsService.add({ workItemId: "other-task", userId: ME, body: "x", parentId: root.id }),
      ).rejects.toThrow(/Parent comment not found/);
    });
  });

  describe("edit", () => {
    it("updates the body and stamps edited_at", async () => {
      const c = await add("old");
      await commentsService.edit(c.id, "new body");
      expect(db.comments[0]).toMatchObject({ body: "new body", edited_at: "now" });
    });

    it("rejects empty and oversize bodies", async () => {
      const c = await add("old");
      await expect(commentsService.edit(c.id, "  ")).rejects.toThrow(/empty/);
      await expect(commentsService.edit(c.id, "x".repeat(50001))).rejects.toThrow(/long/);
    });

    it("fails for a comment that is not yours or is deleted", async () => {
      db.comments.push({ id: "theirs", work_item_id: TASK, user_id: NIRAV, body: "x", deleted_at: null });
      await expect(commentsService.edit("theirs", "hacked")).rejects.toThrow(/not editable/);
      const c = await add("mine");
      await commentsService.remove(c.id);
      await expect(commentsService.edit(c.id, "zombie")).rejects.toThrow(/not editable/);
    });

    it("re-syncs mentions: adds new people, removes dropped ones, no duplicate notification", async () => {
      const c = await add("@Nirav Thakkar look", [NIRAV]);
      expect(db.notifications).toHaveLength(1);

      await commentsService.edit(c.id, "@Nirav Thakkar and @Miraj Shah look", [NIRAV, MIRAJ]);
      expect(db.mentions.map((m) => m.mentioned_user_id).sort()).toEqual([NIRAV, MIRAJ].sort());
      expect(db.notifications.map((n) => n.user_id).sort()).toEqual([NIRAV, MIRAJ].sort());

      await commentsService.edit(c.id, "@Miraj Shah look", [MIRAJ]);
      expect(db.mentions.map((m) => m.mentioned_user_id)).toEqual([MIRAJ]);
      expect(db.notifications).toHaveLength(2);
    });

    it("leaves mentions alone when no list is sent", async () => {
      const c = await add("@Nirav Thakkar", [NIRAV]);
      await commentsService.edit(c.id, "@Nirav Thakkar edited");
      expect(db.mentions).toHaveLength(1);
    });
  });

  describe("list / remove / mentionable users", () => {
    it("list returns each comment's mention ids", async () => {
      await add("@Nirav Thakkar", [NIRAV]);
      await add("none");
      const out = await commentsService.list(TASK);
      expect(out.map((c) => c.mentions)).toEqual([[NIRAV], []]);
    });

    it("remove soft-deletes and errors when nothing was deleted", async () => {
      const c = await add("bye");
      await commentsService.remove(c.id);
      expect(db.comments[0]).toMatchObject({ body: "[deleted]", deleted_at: "now" });
      await expect(commentsService.remove(c.id)).rejects.toThrow(/not found|not allowed/);
    });

    it("mentionableUsers returns active users with email and avatar", async () => {
      const users = await commentsService.mentionableUsers();
      expect(users.map((u) => u.display_name)).toEqual(["Sumit Makwana", "Nirav Thakkar", "Miraj Shah"]);
      expect(users[1]).toMatchObject({ email: "nirav@noesisanalytics.co.in", avatar_url: null });
    });
  });
});

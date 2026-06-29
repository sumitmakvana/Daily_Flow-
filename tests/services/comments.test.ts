import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { commentsService, extractMentionTokens } from "@/services/comments";

describe("services/comments", () => {
  beforeEach(() => mockSupabase.reset());

  it("extractMentionTokens parses unique @handles", () => {
    expect(extractMentionTokens("hi @alice and @bob and @alice again")).toEqual(["alice", "bob"]);
    expect(extractMentionTokens("no mentions here")).toEqual([]);
  });

  it("list returns flattened mentions", async () => {
    mockSupabase.queueResponse("select", {
      data: [
        {
          id: "c1",
          work_item_id: "t1",
          parent_comment_id: null,
          user_id: "u1",
          body: "hi @bob",
          created_at: "x",
          edited_at: null,
          deleted_at: null,
          comment_mentions: [{ mentioned_user_id: "u2" }],
        },
      ],
    });
    const out = await commentsService.list("t1");
    expect(out[0].mentions).toEqual(["u2"]);
  });

  it("add rejects empty/oversize body", async () => {
    await expect(commentsService.add({ workItemId: "t1", userId: "u1", body: "  " })).rejects.toThrow(/empty/);
    await expect(commentsService.add({ workItemId: "t1", userId: "u1", body: "x".repeat(4001) })).rejects.toThrow(/long/);
  });

  it("add inserts comment then mentions, dropping self-mention", async () => {
    mockSupabase.queueResponse("insert", { data: { id: "c1", work_item_id: "t1", user_id: "u1", body: "hi", parent_comment_id: null, created_at: "x", edited_at: null, deleted_at: null } });
    mockSupabase.queueResponse("insert", { data: null });
    await commentsService.add({ workItemId: "t1", userId: "u1", body: "hi", mentionUserIds: ["u2", "u1", "u2"] });
    expect(mockSupabase.calls.from).toEqual(["comments", "comment_mentions"]);
    const mentionInsert = mockSupabase.calls.ops[1].payload as Array<{ mentioned_user_id: string }>;
    expect(mentionInsert).toHaveLength(1);
    expect(mentionInsert[0].mentioned_user_id).toBe("u2");
  });

  it("add skips mention insert when none resolved", async () => {
    mockSupabase.queueResponse("insert", { data: { id: "c1" } });
    await commentsService.add({ workItemId: "t1", userId: "u1", body: "hi" });
    expect(mockSupabase.calls.from).toEqual(["comments"]);
  });

  it("add throws on comment insert error", async () => {
    mockSupabase.queueResponse("insert", { error: { message: "x" } });
    await expect(commentsService.add({ workItemId: "t1", userId: "u1", body: "hi" })).rejects.toBeTruthy();
  });

  it("edit validates and updates", async () => {
    mockSupabase.queueResponse("update", { data: null });
    await commentsService.edit("c1", "new body");
    const payload = mockSupabase.calls.ops[0].payload as Record<string, unknown>;
    expect(payload.body).toBe("new body");
    expect(payload.edited_at).toBeTruthy();
  });

  it("edit rejects empty", async () => {
    await expect(commentsService.edit("c1", "  ")).rejects.toThrow(/empty/);
  });

  it("edit throws on db error", async () => {
    mockSupabase.queueResponse("update", { error: { message: "x" } });
    await expect(commentsService.edit("c1", "ok")).rejects.toBeTruthy();
  });

  it("remove soft-deletes", async () => {
    mockSupabase.queueResponse("update", { data: null });
    await commentsService.remove("c1");
    const payload = mockSupabase.calls.ops[0].payload as Record<string, unknown>;
    expect(payload.deleted_at).toBeTruthy();
    expect(payload.body).toBe("[deleted]");
  });

  it("remove throws on db error", async () => {
    mockSupabase.queueResponse("update", { error: { message: "x" } });
    await expect(commentsService.remove("c1")).rejects.toBeTruthy();
  });
});

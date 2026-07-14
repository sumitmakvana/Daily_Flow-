import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Reply, Pencil, Trash2, Check, X, AtSign } from "lucide-react";
import { commentsService, extractMentionTokens, type CommentWithMentions } from "@/services/comments";
import type { Profile } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { toast } from "sonner";

/**
 * Resolves `@token` strings in `body` against `profiles.display_name`
 * (normalized to lower / spaces→underscore). Returns user ids of every
 * profile that matches at least one token.
 */
function resolveMentions(body: string, profiles: Profile[]): string[] {
  const tokens = extractMentionTokens(body).map((t) => t.toLowerCase());
  if (tokens.length === 0) return [];
  return profiles
    .filter((p) => {
      const norm = (p.display_name ?? "").toLowerCase().replace(/\s+/g, "_");
      return tokens.some((t) => norm === t || norm.startsWith(t));
    })
    .map((p) => p.id);
}

function nameOf(id: string | null, profiles: Profile[]) {
  return profiles.find((p) => p.id === id)?.display_name ?? "—";
}

export function CommentsPanel({
  workItemId,
  userId,
  profiles,
  canModerate,
}: {
  workItemId: string;
  userId: string;
  profiles: Profile[];
  /** Manager/admin — can delete any comment. */
  canModerate: boolean;
}) {
  const [items, setItems] = useState<CommentWithMentions[]>([]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await commentsService.list(workItemId));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [workItemId]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const mentionUserIds = resolveMentions(body, profiles);
      const created = await commentsService.add({
        workItemId,
        userId,
        body,
        parentId: replyTo,
        mentionUserIds,
      });
      setItems((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
      setBody("");
      setReplyTo(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await commentsService.edit(editing.id, editing.body);
      setEditing(null);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await commentsService.remove(id);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Thread tree: top-level first, with replies nested 1 level.
  const { roots, repliesByParent } = useMemo(() => {
    const roots: CommentWithMentions[] = [];
    const repliesByParent: Record<string, CommentWithMentions[]> = {};
    for (const c of items) {
      if (c.parent_comment_id) {
        (repliesByParent[c.parent_comment_id] ||= []).push(c);
      } else {
        roots.push(c);
      }
    }
    return { roots, repliesByParent };
  }, [items]);

  const renderComment = (c: CommentWithMentions, isReply = false) => {
    const isOwn = c.user_id === userId;
    const canDelete = isOwn || canModerate;
    const isDeleted = !!c.deleted_at;
    if (editing?.id === c.id) {
      return (
        <div key={c.id} className={isReply ? "ml-6 mt-2" : ""}>
          <Textarea
            rows={2}
            value={editing.body}
            onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
          />
          <div className="mt-1 flex gap-1 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              <X className="h-3 w-3 mr-1" /> Cancel
            </Button>
            <Button size="sm" disabled={busy} onClick={saveEdit}>
              <Check className="h-3 w-3 mr-1" /> Save
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div key={c.id} className={isReply ? "ml-6 mt-2 rounded-md border border-border p-2" : "rounded-md border border-border p-2"}>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{nameOf(c.user_id, profiles)}</span>
          <span>
            {formatRelative(c.created_at)}
            {c.edited_at && !isDeleted && <span className="ml-1 italic">(edited)</span>}
          </span>
        </div>
        <div className={`mt-1 text-xs whitespace-pre-wrap ${isDeleted ? "italic text-muted-foreground" : "text-foreground"}`}>
          {c.body}
        </div>
        {c.mentions.length > 0 && !isDeleted && (
          <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
            {c.mentions.map((uid) => (
              <span key={uid} className="inline-flex items-center gap-0.5 rounded-sm bg-accent px-1">
                <AtSign className="h-2.5 w-2.5" /> {nameOf(uid, profiles)}
              </span>
            ))}
          </div>
        )}
        {!isDeleted && (
          <div className="mt-1 flex gap-1 justify-end">
            {!isReply && (
              <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => setReplyTo(c.id)}>
                <Reply className="h-3 w-3 mr-1" /> Reply
              </Button>
            )}
            {isOwn && (
              <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => setEditing({ id: c.id, body: c.body })}>
                <Pencil className="h-3 w-3" />
              </Button>
            )}
            {canDelete && (
              <Button size="sm" variant="ghost" className="h-6 px-1 text-xs text-destructive" onClick={() => remove(c.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" /> Comments ({items.length})
      </div>
      <div className="space-y-2">
        {roots.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No comments yet.</p>
        )}
        {roots.map((c) => (
          <div key={c.id}>
            {renderComment(c)}
            {(repliesByParent[c.id] ?? []).map((r) => renderComment(r, true))}
            {replyTo === c.id && (
              <div className="ml-6 mt-2 space-y-1">
                <Textarea
                  rows={2}
                  placeholder="Reply… use @name to mention"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => { setReplyTo(null); setBody(""); }}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={busy || !body.trim()} onClick={submit}>
                    Reply
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {replyTo === null && (
        <div className="pt-1 space-y-1">
          <Textarea
            placeholder="Add a comment… use @name to mention"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={busy || !body.trim()} onClick={submit}>
              <MessageSquare className="h-3.5 w-3.5 mr-1" /> Comment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

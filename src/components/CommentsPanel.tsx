import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Reply, Pencil, Trash2, Check, X, AtSign, Image as ImageIcon, Paperclip, FileText } from "lucide-react";
import { commentsService, extractMentionTokens, type CommentWithMentions } from "@/services/comments";
import { attachmentsService } from "@/services/attachments";
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
  const [pendingFiles, setPendingFiles] = useState<Array<{ id: string; file: File; previewUrl: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await commentsService.list(workItemId));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [workItemId]);

  useEffect(() => { void load(); }, [load]);

  const addPendingFiles = (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const newItems: Array<{ id: string; file: File; previewUrl: string }> = [];
    Array.from(files).forEach((f) => {
      if (f.size > 20 * 1024 * 1024) {
        toast.error(`Skipped ${f.name}: Exceeds 20MB limit`);
        return;
      }
      newItems.push({
        id: crypto.randomUUID(),
        file: f,
        previewUrl: URL.createObjectURL(f),
      });
    });
    if (newItems.length > 0) {
      setPendingFiles((prev) => [...prev, ...newItems]);
      toast.success(`Attached ${newItems.length} file(s)`);
    }
  };

  const removePendingFile = (id: string) => {
    setPendingFiles((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          const namedFile = new File([file], `comment_screenshot_${Date.now()}.png`, { type: file.type });
          imageFiles.push(namedFile);
        }
      }
    }
    if (imageFiles.length > 0) {
      addPendingFiles(imageFiles);
    }
  };

  const submit = async () => {
    if (!body.trim() && pendingFiles.length === 0) return;
    setBusy(true);
    try {
      const mentionUserIds = resolveMentions(body, profiles);
      const created = await commentsService.add({
        workItemId,
        userId,
        body: body.trim() || "(Attachment uploaded)",
        parentId: replyTo,
        mentionUserIds,
      });

      if (pendingFiles.length > 0) {
        for (const item of pendingFiles) {
          try {
            await attachmentsService.upload(workItemId, item.file, userId);
          } catch (err) {
            console.error("Failed uploading comment attachment:", err);
          }
        }
        pendingFiles.forEach((x) => URL.revokeObjectURL(x.previewUrl));
        setPendingFiles([]);
      }

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
        <div className="pt-1 space-y-2 bg-card border border-border p-2.5 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground">Add Comment</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="h-6 text-[10px] gap-1 px-2 border-border text-primary hover:bg-primary/10 transition-colors font-medium rounded-lg"
            >
              <ImageIcon className="h-3 w-3 text-primary" />
              <span>Attach Image</span>
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                addPendingFiles(e.target.files);
                if (e.target) e.target.value = "";
              }}
            />
          </div>

          <Textarea
            placeholder="Add a comment… use @name to mention (Tip: Press Ctrl+V to paste screenshot!)"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onPaste={handlePaste}
            className="text-xs bg-background border-border text-foreground"
          />

          {/* Pending Attachment Previews */}
          {pendingFiles.length > 0 && (
            <div className="pt-1 space-y-1 border-t border-border/60">
              <div className="text-[10px] font-semibold text-muted-foreground flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <Paperclip className="h-3 w-3 text-primary" /> Attached Media ({pendingFiles.length})
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {pendingFiles.map((item) => {
                  const isImage = item.file.type.startsWith("image/");
                  return (
                    <div
                      key={item.id}
                      className="relative group bg-secondary/50 border border-border rounded-md p-1 flex items-center gap-1.5 overflow-hidden"
                    >
                      {isImage ? (
                        <img
                          src={item.previewUrl}
                          alt={item.file.name}
                          className="h-8 w-8 object-cover rounded shrink-0 border border-border bg-background"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded bg-secondary flex items-center justify-center shrink-0 border border-border">
                          <FileText className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-medium text-foreground truncate" title={item.file.name}>
                          {item.file.name}
                        </p>
                        <p className="text-[9px] text-muted-foreground font-mono">
                          {(item.file.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removePendingFile(item.id)}
                        className="p-0.5 rounded-full bg-destructive/90 text-white hover:bg-destructive transition-colors shrink-0"
                        title="Remove attachment"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button size="sm" disabled={busy || (!body.trim() && pendingFiles.length === 0)} onClick={submit} className="h-7 text-xs gap-1">
              <MessageSquare className="h-3.5 w-3.5" /> Post Comment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

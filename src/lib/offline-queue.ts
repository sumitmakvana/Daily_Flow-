/**
 * Offline queue for field-team mutations (Phase E3 — Mobile Field Excellence).
 *
 * Persists pending operations in IndexedDB via idb-keyval so they survive
 * tab reloads, app restarts, and full offline sessions. When the browser
 * reports `online`, queued ops are drained with exponential backoff retry.
 *
 * Supported op kinds:
 *  - task.create      → insert into tasks
 *  - task.update      → patch a task by id (status, comment, fields)
 *  - comment.add      → insert into comments
 *  - photo.upload     → upload file to storage + insert attachment row
 *
 * The queue is intentionally backend-agnostic: each op carries the minimum
 * payload needed for a single supabase call. Callers should treat enqueue()
 * as fire-and-forget when offline; UI surfaces pending state via the
 * `offline-queue` change event.
 */
import { get, set, del, keys } from "idb-keyval";
import { supabase } from "@/integrations/supabase/client";

export type QueueOpKind =
  | "task.create"
  | "task.update"
  | "comment.add"
  | "photo.upload"
  | "form.submit";

export interface QueueOp {
  id: string; // local uuid
  kind: QueueOpKind;
  payload: Record<string, unknown>;
  // photo.upload carries a Blob; serialised through IndexedDB natively.
  blob?: Blob;
  blobName?: string;
  blobType?: string;
  workItemId?: string | null;
  userId: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
  lastTriedAt?: number;
  status: "pending" | "failed" | "syncing";
}

const KEY_PREFIX = "ofq:";
const MAX_ATTEMPTS = 6;
const EVENT = "offline-queue";

function emit(detail?: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail }));
  }
}

export const offlineQueue = {
  EVENT,

  isOnline(): boolean {
    return typeof navigator === "undefined" ? true : navigator.onLine;
  },

  async enqueue(op: Omit<QueueOp, "id" | "createdAt" | "attempts" | "status">): Promise<QueueOp> {
    const full: QueueOp = {
      ...op,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      attempts: 0,
      status: "pending",
    };
    await set(KEY_PREFIX + full.id, full);
    emit({ type: "enqueued", id: full.id, kind: full.kind });
    return full;
  },

  async list(): Promise<QueueOp[]> {
    const all = await keys();
    const mine = all.filter((k) => typeof k === "string" && (k as string).startsWith(KEY_PREFIX));
    const rows = await Promise.all(mine.map((k) => get(k as string) as Promise<QueueOp | undefined>));
    return rows.filter(Boolean).sort((a, b) => a!.createdAt - b!.createdAt) as QueueOp[];
  },

  async remove(id: string): Promise<void> {
    await del(KEY_PREFIX + id);
    emit({ type: "removed", id });
  },

  async clearFailed(): Promise<number> {
    const all = await this.list();
    const failed = all.filter((o) => o.status === "failed");
    await Promise.all(failed.map((o) => del(KEY_PREFIX + o.id)));
    emit({ type: "cleared", count: failed.length });
    return failed.length;
  },

  async retry(id: string): Promise<void> {
    const op = (await get(KEY_PREFIX + id)) as QueueOp | undefined;
    if (!op) return;
    op.status = "pending";
    op.attempts = 0;
    op.lastError = undefined;
    await set(KEY_PREFIX + id, op);
    emit({ type: "retry", id });
    void offlineQueue.drain();
  },

  /** Process queue serially with exponential backoff. */
  async drain(): Promise<{ done: number; failed: number }> {
    if (!this.isOnline()) return { done: 0, failed: 0 };
    const ops = await this.list();
    let done = 0;
    let failed = 0;
    for (const op of ops) {
      if (op.status === "failed" && op.attempts >= MAX_ATTEMPTS) continue;
      try {
        op.status = "syncing";
        op.lastTriedAt = Date.now();
        await set(KEY_PREFIX + op.id, op);
        emit({ type: "syncing", id: op.id });

        await executeOp(op);

        await del(KEY_PREFIX + op.id);
        done++;
        emit({ type: "synced", id: op.id, kind: op.kind });
      } catch (err) {
        op.attempts++;
        op.status = op.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
        op.lastError = (err as Error)?.message?.slice(0, 500) ?? "Unknown error";
        await set(KEY_PREFIX + op.id, op);
        failed++;
        emit({ type: "failed", id: op.id, error: op.lastError });
        // backoff before next op
        await new Promise((r) => setTimeout(r, Math.min(2000 * op.attempts, 8000)));
      }
    }
    emit({ type: "drained", done, failed });
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("offline-queue:last-sync", String(Date.now()));
    }
    return { done, failed };
  },

  lastSyncAt(): number | null {
    if (typeof localStorage === "undefined") return null;
    const v = localStorage.getItem("offline-queue:last-sync");
    return v ? Number(v) : null;
  },
};

async function executeOp(op: QueueOp): Promise<void> {
  switch (op.kind) {
    case "task.create": {
      const { error } = await supabase.from("tasks").insert(op.payload as never);
      if (error) throw error;
      return;
    }
    case "task.update": {
      const { id, patch } = op.payload as { id: string; patch: Record<string, unknown> };
      const { error } = await supabase.from("tasks").update(patch as never).eq("id", id);
      if (error) throw error;
      return;
    }
    case "comment.add": {
      const { error } = await supabase.from("comments").insert(op.payload as never);
      if (error) throw error;
      return;
    }
    case "form.submit": {
      const { table, row } = op.payload as { table: string; row: Record<string, unknown> };
      const { error } = await supabase.from(table as never).insert(row as never);
      if (error) throw error;
      return;
    }
    case "photo.upload": {
      if (!op.blob || !op.workItemId) throw new Error("photo.upload missing blob/workItemId");
      const safeName = (op.blobName ?? "photo.jpg").replace(/[^\w.\-]+/g, "_").slice(0, 200);
      const path = `${op.workItemId}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("work-item-files")
        .upload(path, op.blob, { contentType: op.blobType ?? "image/jpeg", upsert: false });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("attachments").insert({
        work_item_id: op.workItemId,
        file_name: safeName,
        file_size: op.blob.size,
        file_type: op.blobType ?? "image/jpeg",
        storage_path: path,
        uploaded_by: op.userId,
      } as never);
      if (insErr) {
        await supabase.storage.from("work-item-files").remove([path]);
        throw insErr;
      }
      return;
    }
  }
}

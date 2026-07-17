/**
 * Attachments service — `attachments` table metadata via TanStack server
 * functions over the pg pool; binary upload / signed URL / object delete
 * still goes through Supabase Storage (`work-item-files` bucket), which
 * is intentionally out of scope for this migration.
 *
 * Path convention: `{work_item_id}/{uuid}-{filename}`.
 */
import { supabase } from "@/integrations/supabase/client";
import { storage } from "@/integrations/backend/storage";
import type { Attachment } from "@/lib/types";
import {
  listAttachmentsFn,
  insertAttachmentMetaFn,
  deleteAttachmentMetaFn,
} from "./attachments.functions";

const BUCKET = "work-item-files";
const MAX_BYTES = 20 * 1024 * 1024; // 20MB

const ALLOWED_PREFIXES = ["image/", "audio/", "text/"];
const ALLOWED_EXACT = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
]);

export function isAllowedMime(mime: string): boolean {
  if (ALLOWED_EXACT.has(mime)) return true;
  return ALLOWED_PREFIXES.some((p) => mime.startsWith(p));
}

export const attachmentsService = {
  async list(workItemId: string): Promise<Attachment[]> {
    return (await listAttachmentsFn({ data: { workItemId } })) as unknown as Attachment[];
  },

  async upload(workItemId: string, file: File, _userId: string): Promise<Attachment> {
    void _userId;
    if (file.size > MAX_BYTES) throw new Error("File exceeds 20MB limit");
    if (!isAllowedMime(file.type || "application/octet-stream")) {
      throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
    }
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 200);
    const path = `${workItemId}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await storage.upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (upErr) throw upErr;
    try {
      const row = (await insertAttachmentMetaFn({
        data: {
          workItemId,
          fileName: file.name.slice(0, 255),
          fileSize: file.size,
          fileType: file.type || "application/octet-stream",
          storagePath: path,
        },
      })) as unknown as Attachment;
      return row;
    } catch (err) {
      // best-effort cleanup of the orphaned object
      await storage.remove([path]);
      throw err;
    }
  },

  async download(att: Attachment): Promise<string> {
    const { data, error } = await storage.signedUrl(att.storage_path, 300);
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Could not retrieve download URL");
    return data.signedUrl;
  },

  async remove(att: Attachment): Promise<void> {
    await deleteAttachmentMetaFn({ data: { id: att.id } });
    await storage.remove([att.storage_path]);
  },
};

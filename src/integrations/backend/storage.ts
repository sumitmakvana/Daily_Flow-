/**
 * Backend abstraction — storage surface.
 *
 * Today delegates to `supabase.storage`. After cutover, the same three
 * methods (`upload`, `signedUrl`, `remove`) back onto MinIO via the AWS
 * SDK v3 presigner. The bucket name (`work-item-files`) stays identical
 * so object paths and DB rows in `attachments` need no rewrite.
 *
 * Used today by `src/services/attachments.ts` and
 * `src/lib/offline-queue.ts` — both keep their current imports; new code
 * should prefer this module.
 */
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "work-item-files";

export const storage = {
  bucket: BUCKET,
  upload: (path: string, file: File | Blob, opts?: { contentType?: string; upsert?: boolean }) =>
    supabase.storage.from(BUCKET).upload(path, file, opts),
  signedUrl: (path: string, expiresIn = 300) =>
    supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn),
  remove: (paths: string[]) => supabase.storage.from(BUCKET).remove(paths),
};

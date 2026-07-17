/**
 * Backend abstraction — storage surface.
 *
 * Checks process.env.BACKEND_MODE on the server.
 * If set to 'self', it stores file binaries directly in PostgreSQL bytea column.
 * Otherwise, it delegates to Supabase storage.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { adminQuery } from "@/integrations/postgres/query.server";
import { z } from "zod";

const BUCKET = "work-item-files";

// Server function to upload and store file binaries (either in local DB or Supabase)
const uploadFileFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((fd: FormData) => fd)
  .handler(async ({ data: formData, context }) => {
    const file = formData.get("file") as File;
    const path = formData.get("path") as string;
    
    if (!file || !path) {
      throw new Error("Missing file or path in upload data");
    }

    const mode = process.env.BACKEND_MODE ?? "supabase";

    if (mode === "self") {
      const buffer = Buffer.from(await file.arrayBuffer());
      const workItemId = path.split("/")[0];

      // Ensure the bytea file_data column exists in the database
      await adminQuery("ALTER TABLE public.attachments ADD COLUMN IF NOT EXISTS file_data bytea");

      // Insert/update row containing binary data
      await adminQuery(
        `INSERT INTO public.attachments 
           (work_item_id, file_name, file_size, file_type, storage_path, uploaded_by, file_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (storage_path) DO UPDATE SET
           file_data = EXCLUDED.file_data`,
        [
          workItemId,
          file.name.slice(0, 255),
          file.size,
          file.type || "application/octet-stream",
          path,
          context.userId,
          buffer,
        ]
      );
      return { path };
    } else {
      // Fallback: Upload to Supabase Storage using admin client
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: true,
      });
      if (error) throw error;
      return { path: data.path };
    }
  });

// Server function to generate a secure local proxy signed URL (or Supabase signed URL)
const getDownloadUrlFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string; expiresIn: number }) =>
    z.object({ path: z.string(), expiresIn: z.number() }).parse(d),
  )
  .handler(async ({ data }) => {
    const mode = process.env.BACKEND_MODE ?? "supabase";

    if (mode === "self") {
      const { createHmac } = await import("crypto");
      
      const expires = Date.now() + data.expiresIn * 1000;
      const secret = process.env.CRON_SECRET || "default-fallback-storage-secret";
      const token = createHmac("sha256", secret)
        .update(`${data.path}:${expires}`)
        .digest("hex");

      // Return relative URL pointing to our local storage proxy endpoint
      return `/api/storage/file?path=${encodeURIComponent(data.path)}&token=${token}&expires=${expires}`;
    } else {
      // Fallback: Get signed URL from Supabase Storage
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: res, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(data.path, data.expiresIn);
      if (error) throw error;
      return res.signedUrl;
    }
  });

// Server function to delete files (either from local DB or Supabase)
const deleteObjectsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((paths: string[]) => z.array(z.string()).parse(paths))
  .handler(async ({ data: paths }) => {
    if (paths.length === 0) return { success: true };
    
    const mode = process.env.BACKEND_MODE ?? "supabase";

    if (mode === "self") {
      await adminQuery(
        `DELETE FROM public.attachments WHERE storage_path = ANY($1)`,
        [paths]
      );
      return { success: true };
    } else {
      // Fallback: Delete from Supabase Storage
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin.storage.from(BUCKET).remove(paths);
      if (error) throw error;
      return { success: true };
    }
  });

export const storage = {
  bucket: BUCKET,

  upload: async (
    path: string,
    file: File | Blob,
    opts?: { contentType?: string; upsert?: boolean }
  ): Promise<{ data: { path: string } | null; error: Error | null }> => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("path", path);

      const res = await uploadFileFn({ data: formData });
      return { data: { path: res.path }, error: null };
    } catch (err) {
      console.error("Storage upload error:", err);
      return { data: null, error: err as Error };
    }
  },

  signedUrl: async (
    path: string,
    expiresIn = 300
  ): Promise<{ data: { signedUrl: string } | null; error: Error | null }> => {
    try {
      const signedUrl = await getDownloadUrlFn({ data: { path, expiresIn } });
      return { data: { signedUrl }, error: null };
    } catch (err) {
      console.error("Storage signedUrl error:", err);
      return { data: null, error: err as Error };
    }
  },

  remove: async (
    paths: string[]
  ): Promise<{ data: string[] | null; error: Error | null }> => {
    try {
      await deleteObjectsFn({ data: paths });
      return { data: paths, error: null };
    } catch (err) {
      console.error("Storage remove error:", err);
      return { data: null, error: err as Error };
    }
  },
};

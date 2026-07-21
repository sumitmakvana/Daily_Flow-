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

      const res = await fetch("/api/storage/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(errJson.error || `Upload failed with status ${res.status}`);
      }

      const resData = await res.json();
      return { data: { path: resData.path }, error: null };
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

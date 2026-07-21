import { createFileRoute } from "@tanstack/react-router";
import { adminQuery } from "@/integrations/postgres/query.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "work-item-files";

export const Route = createFileRoute("/api/storage/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const formData = await request.formData();
          const file = formData.get("file") as File;
          const path = formData.get("path") as string;
          const userId = formData.get("userId") as string;

          if (!file || !path) {
            return Response.json({ error: "Missing file or path" }, { status: 400 });
          }

          const mode = process.env.BACKEND_MODE ?? "supabase";

          if (mode === "self") {
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const workItemId = path.split("/")[0];

            // Ensure bytea column exists
            await adminQuery("ALTER TABLE public.attachments ADD COLUMN IF NOT EXISTS file_data bytea");

            // Store binary buffer in attachments table
            await adminQuery(
              `INSERT INTO public.attachments 
                 (work_item_id, file_name, file_size, file_type, storage_path, uploaded_by, file_data)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (storage_path) DO UPDATE SET
                 file_data = EXCLUDED.file_data,
                 file_size = EXCLUDED.file_size,
                 file_type = EXCLUDED.file_type`,
              [
                workItemId,
                file.name.slice(0, 255),
                file.size,
                file.type || "application/octet-stream",
                path,
                userId || null,
                buffer,
              ]
            );

            return Response.json({ path });
          } else {
            // Fallback: Upload to Supabase Storage using admin client
            const { data, error } = await supabaseAdmin.storage.from(BUCKET).upload(path, file, {
              contentType: file.type || "application/octet-stream",
              upsert: true,
            });
            if (error) return Response.json({ error: error.message }, { status: 500 });
            return Response.json({ path: data.path });
          }
        } catch (err: any) {
          console.error("Storage upload route error:", err);
          return Response.json({ error: err.message || "Upload error" }, { status: 500 });
        }
      },
    },
  },
});

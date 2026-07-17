import { createFileRoute } from "@tanstack/react-router";
import { adminQuery } from "@/integrations/postgres/query.server";
import { createHmac } from "crypto";

const getSecret = () => {
  return process.env.CRON_SECRET || "default-fallback-storage-secret";
};

const verifySignedToken = (path: string, expires: number, token: string) => {
  if (Date.now() > expires) {
    console.error(`Token expired. Current time: ${Date.now()}, Expiry: ${expires}`);
    return false;
  }
  const secret = getSecret();
  const expected = createHmac("sha256", secret)
    .update(`${path}:${expires}`)
    .digest("hex");
  return token === expected;
};

export const Route = createFileRoute("/api/storage/file")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const path = url.searchParams.get("path");
          const token = url.searchParams.get("token");
          const expires = url.searchParams.get("expires");

          if (!path || !token || !expires) {
            return new Response("Missing required query parameters", { status: 400 });
          }

          // Verify the HMAC token
          if (!verifySignedToken(path, Number(expires), token)) {
            return new Response("Unauthorized or expired access token", { status: 403 });
          }

          // Fetch the file binary from PostgreSQL
          const res = await adminQuery(
            `SELECT file_data, file_type, file_name 
             FROM public.attachments 
             WHERE storage_path = $1`,
            [path]
          );

          if (res.rows.length === 0) {
            return new Response("File not found in database", { status: 404 });
          }

          const row = res.rows[0];
          const bytes = row.file_data;

          if (!bytes) {
            return new Response("File has no binary data stored", { status: 404 });
          }

          return new Response(bytes, {
            headers: {
              "Content-Type": row.file_type || "application/octet-stream",
              "Content-Length": String(bytes.length),
              "Content-Disposition": `inline; filename="${encodeURIComponent(row.file_name || "file")}"`,
              "Cache-Control": "private, max-age=3600",
            },
          });
        } catch (err: any) {
          console.error("Local storage DB proxy route error:", err);
          return new Response("File access error", { status: 500 });
        }
      },
    },
  },
});

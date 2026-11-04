import { createFileRoute } from "@tanstack/react-router";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { runMorningDigest } from "@/lib/digests/morning-digest.server";

/** Cron endpoint. Always authenticated, also with ?force=true (a manual re-run outside the configured time). */
export const Route = createFileRoute("/api/public/hooks/morning-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "morning-digest");
        if (denied) return denied;
        const force = new URL(request.url).searchParams.get("force") === "true";
        return runMorningDigest(force ? "force" : "cron");
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { runEveningDigest } from "@/lib/digests/evening-digest.server";

/** Cron endpoint. Always authenticated, also with ?force=true (a manual re-run outside the configured time). */
export const Route = createFileRoute("/api/public/hooks/evening-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "evening-digest");
        if (denied) return denied;
        const params = new URL(request.url).searchParams;
        const targetEmails = params.get("target_email") || params.get("email") || "";
        return runEveningDigest(params.get("force") === "true" ? "force" : "cron", { targetEmails });
      },
    },
  },
});

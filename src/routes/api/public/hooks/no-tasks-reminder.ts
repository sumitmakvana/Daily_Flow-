import { createFileRoute } from "@tanstack/react-router";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { runNoTasksReminder } from "@/lib/digests/no-tasks-reminder.server";

/** Cron endpoint. Always authenticated, also with ?force=true (a manual re-run outside the configured time). */
export const Route = createFileRoute("/api/public/hooks/no-tasks-reminder")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "no-tasks-reminder");
        if (denied) return denied;
        const force = new URL(request.url).searchParams.get("force") === "true";
        return runNoTasksReminder(force ? "force" : "cron");
      },
    },
  },
});

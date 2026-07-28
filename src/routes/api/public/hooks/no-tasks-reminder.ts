import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { recordFailure } from "@/lib/ops-failures.server";

/**
 * Recurring reminder cron (intended to run every 20 minutes).
 * Sends a nudge to active users who still have 0 tasks on their plate today.
 * Only runs during configured working hours.
 */
export const Route = createFileRoute("/api/public/hooks/no-tasks-reminder")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await requireCronAuth(request, "no-tasks-reminder");
        if (denied) return denied;

        const today = new Date().toISOString().slice(0, 10);
        const todayMs = new Date(today).getTime();

        // Get current time in Indian Standard Time (IST)
        const kolkataTime = new Date().toLocaleTimeString("en-US", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        const currentHour = new Date().toLocaleTimeString("en-US", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          hour12: false,
        });
        const currentMinute = new Date().toLocaleTimeString("en-US", {
          timeZone: "Asia/Kolkata",
          minute: "2-digit",
        });

        const [{ data: profiles }, { data: tasks }, { data: prefs }, { data: settings }, { data: activeReminders }] = await Promise.all([
          supabaseAdmin
            .from("profiles")
            .select("id, display_name, manager_id, is_active")
            .eq("is_active", true),
          supabaseAdmin
            .from("tasks")
            .select("id, task_code, task_name, assigned_to, status, priority, due_date"),
          supabaseAdmin.from("notification_prefs").select("user_id, digest_enabled"),
          supabaseAdmin.from("work_settings").select("morning_digest_time, evening_digest_time, no_tasks_reminder_interval").eq("id", 1).maybeSingle(),
          supabaseAdmin
            .from("notifications")
            .select("user_id")
            .eq("title", "Reminder: 0 tasks on plate")
            .is("read_at", null),
        ]);

        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "true";
        const morningTime = settings?.morning_digest_time ?? "11:00";
        const eveningTime = settings?.evening_digest_time ?? "18:00";
        const interval = settings?.no_tasks_reminder_interval ?? 20;

        // If reminder is disabled, skip sending (unless forced)
        if (interval <= 0 && !force) {
          return Response.json({
            ok: true,
            skipped: true,
            reason: "No-tasks reminder is disabled in settings",
          });
        }

        // Check if current time is within working hours (morning time to evening time)
        if ((kolkataTime < morningTime || kolkataTime >= eveningTime) && !force) {
          return Response.json({
            ok: true,
            skipped: true,
            reason: `Current local time ${kolkataTime} is outside working hours (${morningTime} to ${eveningTime})`,
          });
        }

        const optedOut = new Set(
          (prefs ?? []).filter((p) => p.digest_enabled === false).map((p) => p.user_id),
        );
        const activeIds = new Set((profiles ?? []).map((p) => p.id));
        const activeReminderUserIds = new Set(
          (activeReminders ?? []).map((r) => r.user_id),
        );

        const plateByUser = new Map<string, NonNullable<typeof tasks>>();
        for (const t of tasks ?? []) {
          if (!t.assigned_to || !activeIds.has(t.assigned_to)) continue;
          if (t.status === "Completed") continue;
          const dueMs = t.due_date ? new Date(t.due_date).getTime() : null;
          if (dueMs === null || dueMs <= todayMs) {
            const arr = plateByUser.get(t.assigned_to) ?? [];
            arr.push(t);
            plateByUser.set(t.assigned_to, arr);
          }
        }

        let sentUsers = 0;
        let failed = 0;

        const h = parseInt(currentHour, 10);
        const m = parseInt(currentMinute, 10);
        const slotInterval = interval > 0 ? interval : 20; // fallback to 20 if disabled but forced
        const slot = Math.floor(m / slotInterval); 

        for (const p of profiles ?? []) {
          const mine = plateByUser.get(p.id) ?? [];
          // Only notify if they have absolutely 0 tasks on plate
          if (mine.length > 0) continue;

          // If the user already has an active, unread 0-tasks reminder, do not send another one
          if (activeReminderUserIds.has(p.id)) continue;

          if (!optedOut.has(p.id)) {
            // Deduplication key changes every X minutes based on interval to prevent sending multiple per slot
            const dedupeKey = `NO_TASKS_REMINDER_${today}_${h}_${slot}_${p.id}`;
            const { error } = await supabaseAdmin.from("notifications").insert({
              user_id: p.id,
              type: "sod_digest", // Re-use type so click handler automatically handles it
              title: "Reminder: 0 tasks on plate",
              body: "You still have no tasks on your plate today. Click here to add a task.",
              dedupe_key: dedupeKey,
            });

            if (!error) sentUsers += 1;
            else if (error.code === "23505") {
              // already sent in this slot
            } else {
              failed += 1;
              await recordFailure({
                source: "cron.no_tasks_reminder",
                entityType: "user",
                entityId: p.id,
                errorCode: error.code ?? null,
                errorMessage: error.message,
              });
            }
          }
        }

        return Response.json({ ok: true, sentUsers, failed });
      },
    },
  },
});

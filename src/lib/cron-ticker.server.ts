import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPool } from "@/integrations/postgres/client.server";

import { getTodayDateStr } from "@/lib/task-date-utils";

import { checkIsWorkingDayServer } from "@/lib/workday-checker.server";
import { pushOverdueTasks } from "@/lib/task-push.server";
import { promoteDueTentativeLeaves } from "@/services/leaves.server";
import { runMorningDigest } from "@/lib/digests/morning-digest.server";
import { runEveningDigest } from "@/lib/digests/evening-digest.server";
import { runNoTasksReminder } from "@/lib/digests/no-tasks-reminder.server";

/**
 * The ONLY scheduler for the digests (the pg_cron digest jobs are removed): morning digest, evening digest (member
 * EOD + manager team report), no-tasks reminder, advance leave alerts and overdue pushes. Each minute it only
 * compares the clock with cached settings; the digests read their data only at their configured minute.
 */
const PROMOTE_EVERY_MS = 5 * 60_000;
const SETTINGS_TTL_MS = 5 * 60_000;
const NO_TASKS_REMINDER_EVERY_MIN = 20;
/** How long after its configured minute a job may still start (covers a tick that skipped the exact minute). */
const DUE_WINDOW_MIN = 5;
/**
 * The email dispatcher drops a second email to the same recipient within 10 s. A digest emails managers and the
 * leave alerts right after it email the same managers, so they are sent this long after the digest.
 */
const GAP_BEFORE_LEAVE_ALERTS_MS = 15_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type TickerSettings = { date: string; at: number; isWorkingDay: boolean; morningTime: string; eveningTime: string };

// Global singleton state to survive Vite / HMR module re-evaluations in dev server
const globalCronState = globalThis as unknown as {
  __cronTickerInterval?: NodeJS.Timeout;
  __cronFiredKeys?: Set<string>;
  __tickerSettings?: TickerSettings;
  __lastPromoteDate?: string;
  __lastPromoteAt?: number;
};

if (!globalCronState.__cronFiredKeys) {
  globalCronState.__cronFiredKeys = new Set<string>();
}

export function startBackgroundCronTicker() {
  // If an interval already exists (e.g. across Vite HMR reloads), clear it first
  if (globalCronState.__cronTickerInterval) {
    clearInterval(globalCronState.__cronTickerInterval);
    globalCronState.__cronTickerInterval = undefined;
  }

  console.log("[CronTicker] Starting automated background EOD cron ticker (60s loop)...");

  globalCronState.__cronTickerInterval = setInterval(async () => {
    try {
      const todayStr = getTodayDateStr("Asia/Kolkata");
      const now = Date.now();

      // New day: forget the previous days' fired keys.
      if (globalCronState.__lastPromoteDate !== todayStr) {
        for (const k of globalCronState.__cronFiredKeys!) if (!k.startsWith(todayStr)) globalCronState.__cronFiredKeys!.delete(k);
      }

      // Promote due tentative leaves to approved Planned Leave (idempotent; runs before the working-day
      // check so a missed day is caught up). Every 5 minutes, and at once when the date changes.
      if (globalCronState.__lastPromoteDate !== todayStr || now - (globalCronState.__lastPromoteAt ?? 0) >= PROMOTE_EVERY_MS) {
        globalCronState.__lastPromoteDate = todayStr;
        globalCronState.__lastPromoteAt = now;
        await promoteDueTentativeLeaves(todayStr);
      }

      // Working day + configured times change rarely: read them once per SETTINGS_TTL_MS (and when the date
      // changes) instead of every minute.
      const cached = globalCronState.__tickerSettings;
      const settingsFresh = cached && cached.date === todayStr && now - cached.at < SETTINGS_TTL_MS;
      const tick = settingsFresh
        ? cached
        : await (async () => {
            const workStatus = await checkIsWorkingDayServer(todayStr);
            const { data: settings } = await supabaseAdmin
              .from("work_settings")
              .select("morning_digest_time, evening_digest_time")
              .eq("id", 1)
              .maybeSingle();
            const fresh = {
              date: todayStr,
              at: now,
              isWorkingDay: workStatus.isWorkingDay,
              morningTime: settings?.morning_digest_time ?? "10:30", // Dynamic from UI
              eveningTime: settings?.evening_digest_time ?? "18:00", // Dynamic from UI
            };
            globalCronState.__tickerSettings = fresh;
            return fresh;
          })();
      if (!tick.isWorkingDay) {
        // Skip automated digests and notifications on non-working days & holidays
        return;
      }

      const currentLocalTime = new Date().toLocaleTimeString("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const currentMinute = Number(currentLocalTime.slice(3, 5));
      const nowMins = Number(currentLocalTime.slice(0, 2)) * 60 + currentMinute;
      // A 60 s interval drifts, so one tick can skip a whole minute: a job is due from its configured minute for
      // DUE_WINDOW_MIN minutes, and the fired key makes it run once.
      const isDue = (hhmm: string) => {
        const diff = nowMins - (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)));
        return diff >= 0 && diff < DUE_WINDOW_MIN;
      };

      const morningFireKey = `${todayStr}_morning_${tick.morningTime}`;
      const eveningFireKey = `${todayStr}_evening_${tick.eveningTime}`;

      // -------------------------------------------------------------
      // STEP A: At Configured Morning Time (UI Setting) -> Morning Digest & Leave Alerts
      // -------------------------------------------------------------
      if (isDue(tick.morningTime) && !globalCronState.__cronFiredKeys!.has(morningFireKey)) {
        globalCronState.__cronFiredKeys!.add(morningFireKey);
        console.log(
          `[CronTicker] Morning Digest due (${currentLocalTime}, configured ${tick.morningTime})! Triggering Morning Digest & Leave Alerts...`,
        );

        try {
          await runMorningDigest("scheduled");
        } catch (err) {
          console.error("[CronTicker] Error running morning digest:", err);
        }

        // Dispatch advance alerts for leaves starting tomorrow morning
        await sleep(GAP_BEFORE_LEAVE_ALERTS_MS);
        await dispatchAdvanceLeaveAlerts("morning", todayStr);

        // Push alerts for tasks that just became overdue (no-op unless FCM is configured)
        await pushOverdueTasks(todayStr);
      }

      // -------------------------------------------------------------
      // STEP B: At Configured Evening Time (UI Setting) -> Member EOD digest + Manager EOD team report
      // (both sent by the evening digest, idempotent per day) & Handover Alerts
      // -------------------------------------------------------------
      if (isDue(tick.eveningTime) && !globalCronState.__cronFiredKeys!.has(eveningFireKey)) {
        globalCronState.__cronFiredKeys!.add(eveningFireKey);
        console.log(
          `[CronTicker] Evening Digest due (${currentLocalTime}, configured ${tick.eveningTime})! Triggering Member EOD, Manager Report & Leave Alerts...`,
        );

        try {
          await runEveningDigest("scheduled");
        } catch (err) {
          console.error("[CronTicker] Error running evening digest:", err);
        }

        // Dispatch advance handover alerts for leaves starting tomorrow evening
        await sleep(GAP_BEFORE_LEAVE_ALERTS_MS);
        await dispatchAdvanceLeaveAlerts("evening", todayStr);
      }

      // -------------------------------------------------------------
      // STEP C: No-tasks reminder, every 20 minutes (:00 / :20 / :40) like the former pg_cron job. The reminder
      // itself skips outside working hours or when it is disabled in settings.
      // -------------------------------------------------------------
      const reminderFireKey = `${todayStr}_reminder_${currentLocalTime.slice(0, 2)}_${Math.floor(currentMinute / NO_TASKS_REMINDER_EVERY_MIN)}`;
      if (currentMinute % NO_TASKS_REMINDER_EVERY_MIN < DUE_WINDOW_MIN && !globalCronState.__cronFiredKeys!.has(reminderFireKey)) {
        globalCronState.__cronFiredKeys!.add(reminderFireKey);
        try {
          await runNoTasksReminder("scheduled");
        } catch (err) {
          console.error("[CronTicker] Error running no-tasks reminder:", err);
        }
      }
    } catch (err) {
      console.error("[CronTicker] Error in background EOD cron loop:", err);
    }
  }, 60000); // Check every 60 seconds
}

/**
 * Scans active leaves starting tomorrow and dispatches advance notifications to managers
 */
async function dispatchAdvanceLeaveAlerts(timeSlot: "morning" | "evening", todayStr: string) {
  try {
    const pool = getPool();
    const tomorrowRes = await pool.query<{ tomorrow: string }>(
      `SELECT (CURRENT_DATE + INTERVAL '1 day')::date::text as tomorrow`
    );
    const tomorrowStr = tomorrowRes.rows[0]?.tomorrow;
    if (!tomorrowStr) return;

    // Query active/approved leaves spanning tomorrow
    const leavesRes = await pool.query<{
      id: string;
      user_id: string;
      leave_type: string;
      start_date: string;
      end_date: string;
      reason: string;
      user_name: string;
      manager_id: string | null;
    }>(
      `SELECT 
        l.id,
        l.user_id,
        l.leave_type,
        l.start_date::text,
        l.end_date::text,
        l.reason,
        p.display_name as user_name,
        p.manager_id
      FROM public.leaves l
      JOIN public.profiles p ON p.id = l.user_id
      WHERE l.status = 'approved'
        AND $1::date BETWEEN l.start_date AND l.end_date`,
      [tomorrowStr]
    );

    if (!leavesRes.rows || leavesRes.rows.length === 0) return;

    // Find all managers / admins
    const managersRes = await pool.query<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM public.user_roles WHERE role IN ('admin', 'manager')`
    );
    const allManagerIds = managersRes.rows.map((r) => r.user_id);

    for (const leave of leavesRes.rows) {
      const isWfh = leave.leave_type === "wfh";
      const dedupeKey = `LEAVE_ADVANCE_${timeSlot.toUpperCase()}_${todayStr}_${leave.id}`;

      const title = isWfh
        ? `🏠 Tomorrow WFH Notice: ${leave.user_name}`
        : `📅 Tomorrow Leave Alert: ${leave.user_name}`;

      const body =
        timeSlot === "morning"
          ? `Reminder: ${leave.user_name} will be on ${isWfh ? "WFH" : "Leave"} tomorrow (${tomorrowStr}). Reason: "${leave.reason}". Please plan tasks accordingly and avoid assigning urgent work.`
          : `Evening Handover Reminder: ${leave.user_name} is on ${isWfh ? "WFH" : "Leave"} tomorrow (${tomorrowStr}). Ensure all pending items are handed over today.`;

      const targetManagers = new Set<string>(allManagerIds);
      if (leave.manager_id) targetManagers.add(leave.manager_id);
      targetManagers.delete(leave.user_id); // Don't notify the employee themselves

      for (const mId of targetManagers) {
        // Check idempotency
        const existing = await pool.query(
          `SELECT 1 FROM public.notifications WHERE title = $1 AND user_id = $2 AND created_at >= CURRENT_DATE`,
          [title, mId]
        );
        if (existing.rows.length === 0) {
          const notifType = isWfh ? "wfh_advance_alert" : "leave_advance_alert";
          await pool.query(
            `INSERT INTO public.notifications (user_id, type, title, body)
             VALUES ($1, $2, $3, $4)`,
            [mId, notifType, title, body]
          );
        }
      }
    }
  } catch (err) {
    console.warn("[CronTicker] Advance leave alert dispatch warning:", (err as Error).message);
  }
}


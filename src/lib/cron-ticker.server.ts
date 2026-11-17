import { getPool } from "@/integrations/postgres/client.server";

import { getTodayDateStr } from "@/lib/task-date-utils";

import { checkIsWorkingDayServer, readWorkSettingsServer } from "@/lib/workday-checker.server";
import { markTickerSettingsStale, takeTickerSettingsStale } from "@/lib/ticker-settings-cache.server";
import { pushOverdueTasks } from "@/lib/task-push.server";
import { promoteDueTentativeLeaves } from "@/services/leaves.server";
import { runMorningDigest } from "@/lib/digests/morning-digest.server";
import { runEveningDigest } from "@/lib/digests/evening-digest.server";

/**
 * The ONLY scheduler for the digests (the former pg_cron jobs that curled the hooks every minute are unscheduled by
 * supabase/migrations/20261116000000_remove_pg_cron_http_hooks.sql): morning digest, evening digest (member
 * EOD + manager team report), advance leave alerts and overdue pushes. Each minute it only
 * compares the clock with cached settings; the digests read their data only at their configured minute.
 */
const PROMOTE_RETRY_MS = 5 * 60_000;
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
  __promoting?: boolean;
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

      // Promote due tentative leaves to approved Planned Leave once per IST day: the first tick after midnight IST
      // (or after a server start, which also catches up a missed day). The date is recorded only on success, so a
      // failure is retried (at most every PROMOTE_RETRY_MS) and never blocks the digests below. The UPDATE only
      // matches rows still tentative, so a repeat run can't promote or notify twice.
      if (
        globalCronState.__lastPromoteDate !== todayStr &&
        !globalCronState.__promoting &&
        now - (globalCronState.__lastPromoteAt ?? 0) >= PROMOTE_RETRY_MS
      ) {
        globalCronState.__promoting = true;
        globalCronState.__lastPromoteAt = now;
        try {
          await promoteDueTentativeLeaves(todayStr, { throwOnError: true });
          globalCronState.__lastPromoteDate = todayStr;
        } catch (err) {
          console.error("[CronTicker] Tentative leave promotion failed, will retry:", (err as Error).message);
        } finally {
          globalCronState.__promoting = false;
        }
      }

      // Working day + configured times only change when the IST date changes or an admin edits them: read them
      // once per IST day (the first tick of the day, or after a server start), and again on the next tick after
      // an in-app edit of work_settings or holiday_calendar (markTickerSettingsStale).
      const cached = globalCronState.__tickerSettings;
      const cachedToday = cached && cached.date === todayStr ? cached : undefined;
      const stale = takeTickerSettingsStale();
      let tick: TickerSettings;
      if (cachedToday && !stale) {
        tick = cachedToday;
      } else {
        try {
          // One read of work_settings (workdays + both digest times) over the DB pool, shared with the
          // working-day check, instead of two PostgREST HTTP requests for the same row. A failed read throws
          // (never replaced by defaults), so a wrong day or time is never cached.
          const settings = await readWorkSettingsServer({ throwOnError: true });
          const workStatus = await checkIsWorkingDayServer(todayStr, settings?.workdays ?? null, { throwOnError: true });
          tick = {
            date: todayStr,
            at: now,
            isWorkingDay: workStatus.isWorkingDay,
            // Defaults only when the row or column is absent, never because a read failed.
            morningTime: settings?.morning_digest_time ?? "10:30", // Dynamic from UI
            eveningTime: settings?.evening_digest_time ?? "18:00", // Dynamic from UI
          };
          globalCronState.__tickerSettings = tick;
        } catch (err) {
          // Not cached, so the next tick retries. Keep today's last good values if there are any (and keep the
          // stale mark, so the edit is still picked up); otherwise skip this minute rather than guess (a job stays
          // due for DUE_WINDOW_MIN minutes, so one failed minute does not lose it).
          if (stale) markTickerSettingsStale();
          if (!cachedToday) {
            console.error("[CronTicker] Settings unavailable, skipping this minute:", (err as Error).message);
            return;
          }
          console.error("[CronTicker] Settings refresh failed, using today's last good values:", (err as Error).message);
          tick = cachedToday;
        }
      }
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

        // Advance alerts for leaves/WFH starting tomorrow (morning only, once per event)
        await sleep(GAP_BEFORE_LEAVE_ALERTS_MS);
        await dispatchAdvanceLeaveAlerts();

        // Push alerts for tasks that just became overdue (no-op unless FCM is configured)
        await pushOverdueTasks(todayStr);
      }

      // -------------------------------------------------------------
      // STEP B: At Configured Evening Time (UI Setting) -> Member EOD digest + Manager EOD team report
      // (both sent by the evening digest, idempotent per day)
      // -------------------------------------------------------------
      if (isDue(tick.eveningTime) && !globalCronState.__cronFiredKeys!.has(eveningFireKey)) {
        globalCronState.__cronFiredKeys!.add(eveningFireKey);
        console.log(
          `[CronTicker] Evening Digest due (${currentLocalTime}, configured ${tick.eveningTime})! Triggering Member EOD & Manager Report...`,
        );

        try {
          await runEveningDigest("scheduled");
        } catch (err) {
          console.error("[CronTicker] Error running evening digest:", err);
        }

      }
    } catch (err) {
      console.error("[CronTicker] Error in background EOD cron loop:", err);
    }
  }, 60000); // Check every 60 seconds
}

/**
 * Scans approved leaves/WFH that START tomorrow and notifies managers once per event (morning only, after the
 * morning digest). Idempotent via the unique notifications.dedupe_key, so a restart or re-run cannot duplicate.
 */
async function dispatchAdvanceLeaveAlerts() {
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
        AND l.start_date = $1::date`,
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
      const title = isWfh
        ? `🏠 Tomorrow WFH Notice: ${leave.user_name}`
        : `📅 Tomorrow Leave Alert: ${leave.user_name}`;

      const body = `Reminder: ${leave.user_name} will be on ${isWfh ? "WFH" : "Leave"} tomorrow (${tomorrowStr}). Reason: "${leave.reason}". Please plan tasks accordingly and avoid assigning urgent work.`;

      const targetManagers = new Set<string>(allManagerIds);
      if (leave.manager_id) targetManagers.add(leave.manager_id);
      targetManagers.delete(leave.user_id); // Don't notify the employee themselves

      for (const mId of targetManagers) {
        const notifType = isWfh ? "wfh_advance_alert" : "leave_advance_alert";
        await pool.query(
          `INSERT INTO public.notifications (user_id, type, title, body, dedupe_key)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [mId, notifType, title, body, `LEAVE_ADVANCE_${leave.id}_${mId}`]
        );
      }
    }
  } catch (err) {
    console.warn("[CronTicker] Advance leave alert dispatch warning:", (err as Error).message);
  }
}


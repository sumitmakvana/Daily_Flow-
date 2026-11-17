import { getPool } from "@/integrations/postgres/client.server";
import { getLocalHoliday } from "@/lib/format";
import { getTodayDateStr } from "@/lib/task-date-utils";
import { promoteDueTentativeLeaves } from "@/services/leaves.server";

export interface WorkingDayCheckResult {
  isWorkingDay: boolean;
  reason: "working_day" | "weekend" | "company_holiday" | "public_holiday";
  label: string;
}

export interface WorkSettingsRow {
  workdays: number[] | null;
  morning_digest_time: string | null;
  evening_digest_time: string | null;
}

/** `throwOnError`: a failed read throws instead of falling back to defaults (for callers that cache the answer). */
export type ReadOptions = { throwOnError?: boolean };

/**
 * The work_settings row (workdays + digest times) in ONE query over the direct DB pool. It used to be two
 * separate PostgREST HTTP requests for the same row. A missing row returns null (callers use their defaults).
 * A failed read is logged and returns null, or throws with `throwOnError`.
 */
export async function readWorkSettingsServer(opts: ReadOptions = {}): Promise<WorkSettingsRow | null> {
  try {
    const { rows } = await getPool().query<WorkSettingsRow>(
      "SELECT workdays, morning_digest_time, evening_digest_time FROM public.work_settings WHERE id = 1",
    );
    return rows[0] ?? null;
  } catch (err) {
    console.error("[workday] work_settings read failed:", (err as Error).message);
    if (opts.throwOnError) throw err;
    return null;
  }
}

/**
 * Checks whether a given target date (defaults to today in IST) is a valid working day.
 * Returns false if the date is a weekend (according to work_settings.workdays) or
 * an official company holiday or public holiday.
 * Pass `knownWorkdays` when the caller already read work_settings, to skip reading it again.
 * With `throwOnError`, a failed work_settings or holiday read throws instead of assuming a working day.
 */
export async function checkIsWorkingDayServer(
  dateStr?: string,
  knownWorkdays?: number[] | null,
  opts: ReadOptions = {},
): Promise<WorkingDayCheckResult> {
  const targetDateStr = dateStr || getTodayDateStr("Asia/Kolkata");
  const [y, m, d] = targetDateStr.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  const jsDay = dateObj.getDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday
  const isoDay = jsDay === 0 ? 7 : jsDay; // 1 = Monday ... 7 = Sunday

  // 1. Workdays configuration from work_settings
  const configured = knownWorkdays !== undefined ? knownWorkdays : (await readWorkSettingsServer(opts))?.workdays;

  const workdays: number[] =
    configured && Array.isArray(configured) && configured.length > 0
      ? configured
      : [1, 2, 3, 4, 5]; // Default Mon-Fri

  // Check if today is a weekend / non-working day according to workdays setting
  if (!workdays.includes(isoDay)) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return {
      isWorkingDay: false,
      reason: "weekend",
      label: `${dayNames[jsDay]} (Non-working day)`,
    };
  }

  // 2. Company holidays (added in Settings > Operations, stored in holiday_calendar)
  try {
    const { rows } = await getPool().query<{ label: string | null }>(
      "SELECT label FROM public.holiday_calendar WHERE calendar_date = $1::date LIMIT 1",
      [targetDateStr],
    );
    if (rows.length > 0) {
      return {
        isWorkingDay: false,
        reason: "company_holiday",
        label: `Official Company Holiday: ${rows[0].label || "Office Holiday"}`,
      };
    }
  } catch (err) {
    if (opts.throwOnError) {
      console.error("[workday] company holiday lookup failed:", (err as Error).message);
      throw err;
    }
    console.error("[workday] company holiday lookup failed, treating the day as a working day:", (err as Error).message);
  }

  // 3. Check public holidays
  const publicHoliday = getLocalHoliday(targetDateStr);
  if (publicHoliday && publicHoliday.isHoliday) {
    return {
      isWorkingDay: false,
      reason: "public_holiday",
      label: `Public Holiday: ${publicHoliday.name}`,
    };
  }

  return {
    isWorkingDay: true,
    reason: "working_day",
    label: "Working Day",
  };
}

/**
 * Returns a Set of user_ids for active team members who have an approved leave on targetDateStr.
 */
export async function getUsersOnLeaveTodayServer(dateStr?: string): Promise<Set<string>> {
  const targetDate = dateStr || getTodayDateStr("Asia/Kolkata");
  try {
    await promoteDueTentativeLeaves(targetDate, { throttle: true });
    const pool = getPool();
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM public.leaves
       WHERE status = 'approved' 
         AND start_date::text <= $1 
         AND end_date::text >= $1`,
      [targetDate]
    );
    return new Set(rows.map((r) => r.user_id));
  } catch (err) {
    return new Set();
  }
}

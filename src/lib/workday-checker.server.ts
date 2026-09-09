import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getPool } from "@/integrations/postgres/client.server";
import { getLocalHoliday } from "@/lib/format";
import { getTodayDateStr } from "@/lib/task-date-utils";

export interface WorkingDayCheckResult {
  isWorkingDay: boolean;
  reason: "working_day" | "weekend" | "company_holiday" | "public_holiday";
  label: string;
}

/**
 * Checks whether a given target date (defaults to today in IST) is a valid working day.
 * Returns false if the date is a weekend (according to work_settings.workdays) or
 * an official company holiday or public holiday.
 */
export async function checkIsWorkingDayServer(dateStr?: string): Promise<WorkingDayCheckResult> {
  const targetDateStr = dateStr || getTodayDateStr("Asia/Kolkata");
  const [y, m, d] = targetDateStr.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  const jsDay = dateObj.getDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday
  const isoDay = jsDay === 0 ? 7 : jsDay; // 1 = Monday ... 7 = Sunday

  // 1. Fetch workdays configuration from work_settings
  const { data: settings } = await supabaseAdmin
    .from("work_settings")
    .select("workdays")
    .eq("id", 1)
    .maybeSingle();

  const workdays: number[] =
    settings?.workdays && Array.isArray(settings.workdays) && settings.workdays.length > 0
      ? settings.workdays
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

  // 2. Fetch custom company holidays from database
  try {
    const pool = getPool();
    const { rows: customHolidays } = await pool.query<{ calendar_date: string; label: string }>(
      "SELECT calendar_date::text AS calendar_date, label FROM public.holidays"
    );

    if (customHolidays && customHolidays.length > 0) {
      const match = customHolidays.find((h) => {
        const raw: unknown = h.calendar_date;
        const str = typeof raw === "string" ? raw : (raw instanceof Date ? raw.toISOString() : String(raw || ""));
        return str.slice(0, 10) === targetDateStr;
      });
      if (match) {
        return {
          isWorkingDay: false,
          reason: "company_holiday",
          label: `Official Company Holiday: ${match.label || "Office Holiday"}`,
        };
      }
    }
  } catch (err) {}

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

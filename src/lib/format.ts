export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export function isOverdue(due: string | null, status: string): boolean {
  if (!due || status === "Completed") return false;
  return new Date(due).getTime() < new Date(new Date().toDateString()).getTime();
}

export function isToday(due: string | null): boolean {
  if (!due) return false;
  const d = new Date(due);
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

export function daysSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/** Today as YYYY-MM-DD in local time. */
export function todayISO(): string {
  return toLocalISO(new Date());
}

/** Format any Date to YYYY-MM-DD in local time. */
export function toLocalISO(date: Date): string {
  const tz = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - tz).toISOString().slice(0, 10);
}

/** Next working day (skip Sat/Sun) as YYYY-MM-DD. */
export function nextWorkingDay(fromISO?: string): string {
  const base = fromISO ? new Date(fromISO) : new Date();
  base.setDate(base.getDate() + 1);
  while (base.getDay() === 0 || base.getDay() === 6) base.setDate(base.getDate() + 1);
  const tz = base.getTimezoneOffset() * 60000;
  return new Date(base.getTime() - tz).toISOString().slice(0, 10);
}

/**
 * Calculates the default start date:
 * Returns the current date (today), or if today is a holiday (or weekend),
 * advances to the next available working date.
 */
export function getDefaultStartDate(
  fromISO?: string | null,
  apiHolidays: Record<string, Holiday> = {},
  customHolidays: Array<{ calendar_date?: string; date?: string }> = []
): string {
  let base: Date;
  if (fromISO) {
    if (fromISO.length === 10 && fromISO.includes("-")) {
      const [y, m, d] = fromISO.split("-").map(Number);
      base = new Date(y, m - 1, d);
    } else {
      base = new Date(fromISO);
    }
  } else {
    base = new Date();
  }
  const customSet = new Set(
    customHolidays
      .map((h) => (h.calendar_date || h.date || "").slice(0, 10))
      .filter(Boolean)
  );

  for (let i = 0; i < 60; i++) {
    const y = base.getFullYear();
    const mStr = String(base.getMonth() + 1).padStart(2, "0");
    const dStr = String(base.getDate()).padStart(2, "0");
    const isoDate = `${y}-${mStr}-${dStr}`;
    const dayOfWeek = base.getDay(); // 0 is Sunday, 6 is Saturday

    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isHoliday = !!getLocalHoliday(isoDate, apiHolidays) || customSet.has(isoDate);

    if (!isWeekend && !isHoliday) {
      return isoDate;
    }
    base.setDate(base.getDate() + 1);
  }

  const y = base.getFullYear();
  const mStr = String(base.getMonth() + 1).padStart(2, "0");
  const dStr = String(base.getDate()).padStart(2, "0");
  return `${y}-${mStr}-${dStr}`;
}

export interface Holiday {
  name: string;
  emoji: string;
  isHoliday: boolean;
}

/**
 * Format a numeric decimal hours value into user-friendly hours and minutes string.
 * Examples: 0.5 -> "30m", 1.5 -> "1h 30m", 0.75 -> "45m", 1 -> "1h", 0.25 -> "15m"
 */
export function formatHoursMins(hoursVal: number | string | null | undefined): string {
  const h = Number(hoursVal ?? 0);
  if (isNaN(h) || h <= 0) return "0h";

  const totalMinutes = Math.round(h * 60);
  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

/**
 * Parses user input strings that may contain hours, minutes, or combinations.
 * Examples: "45m" -> 0.75, "15m" -> 0.25, "30m" -> 0.5, "1h 30m" -> 1.5, "1.5" -> 1.5
 */
export function parseHoursOrMins(inputStr: string): number {
  if (!inputStr) return 0;
  const str = inputStr.trim().toLowerCase();

  // Pattern like "1h 30m" or "1h30m"
  const combinedMatch = str.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?\s*(\d+(?:\.\d+)?)\s*m(?:ins?)?$/);
  if (combinedMatch) {
    const h = parseFloat(combinedMatch[1]);
    const m = parseFloat(combinedMatch[2]);
    return Math.round((h + m / 60) * 100) / 100;
  }

  // Pattern like "45m" or "45 mins" or "45min"
  const minsOnlyMatch = str.match(/^(\d+(?:\.\d+)?)\s*m(?:ins?)?$/);
  if (minsOnlyMatch) {
    const m = parseFloat(minsOnlyMatch[1]);
    return Math.round((m / 60) * 100) / 100;
  }

  // Pattern like "2h" or "1.5 hours"
  const hoursOnlyMatch = str.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/);
  if (hoursOnlyMatch) {
    return parseFloat(hoursOnlyMatch[1]);
  }

  // Direct numeric fallback
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

let cachedHolidays: Record<string, Record<string, Holiday>> = {};
let activeFetches = new Set<number>();

export async function fetchIndianHolidays(year: number): Promise<Record<string, Holiday>> {
  if (cachedHolidays[year]) {
    return cachedHolidays[year];
  }

  const cacheKey = `in_holidays_${year}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      cachedHolidays[year] = JSON.parse(cached);
      return cachedHolidays[year];
    }
  } catch (e) {}

  if (activeFetches.has(year)) {
    return cachedHolidays[year] || {};
  }

  activeFetches.add(year);
  try {
    const res = await fetch(`https://date.nager.at/api/v3/publicholidays/${year}/IN`);
    if (res.ok) {
      const data = await res.json();
      const apiHolidays: Record<string, Holiday> = {};
      
      data.forEach((item: any) => {
        const dateStr = item.date; // YYYY-MM-DD
        let emoji = "🗓️";
        const lowerName = item.name.toLowerCase();
        if (lowerName.includes("republic")) emoji = "🇮🇳";
        else if (lowerName.includes("independence")) emoji = "🇮🇳";
        else if (lowerName.includes("diwali") || lowerName.includes("deepavali")) emoji = "🪔";
        else if (lowerName.includes("holi")) emoji = "🎨";
        else if (lowerName.includes("christmas")) emoji = "🎄";
        else if (lowerName.includes("gandhi")) emoji = "👓";
        else if (lowerName.includes("sankranti") || lowerName.includes("uttarayan")) emoji = "🪁";
        else if (lowerName.includes("eid") || lowerName.includes("ramadan") || lowerName.includes("bakrid")) emoji = "🌙";
        else if (lowerName.includes("good friday")) emoji = "✝️";
        else if (lowerName.includes("raksha") || lowerName.includes("rakhi")) emoji = "🌸";
        else if (lowerName.includes("janmashtami") || lowerName.includes("krishna")) emoji = "🪈";
        else if (lowerName.includes("shivratri")) emoji = "🔱";
        else if (lowerName.includes("ganesh")) emoji = "🐘";
        else if (lowerName.includes("dussehra") || lowerName.includes("dasara") || lowerName.includes("navratri")) emoji = "🏹";
        
        apiHolidays[dateStr] = {
          name: item.localName || item.name,
          emoji,
          isHoliday: true
        };
      });

      cachedHolidays[year] = apiHolidays;
      try {
        localStorage.setItem(cacheKey, JSON.stringify(apiHolidays));
      } catch (e) {}
    }
  } catch (err) {
    console.warn("Failed to fetch holidays from public API:", err);
  } finally {
    activeFetches.delete(year);
  }

  return cachedHolidays[year] || {};
}

export function getLocalHoliday(
  dateOrStr: Date | string | null | undefined,
  apiHolidays: Record<string, Holiday> = {}
): Holiday | null {
  if (!dateOrStr) return null;

  let y = 0;
  let mStr = "";
  let dStr = "";
  let ymd = "";
  let md = "";

  if (typeof dateOrStr === "string") {
    // Expected format YYYY-MM-DD
    const parts = dateOrStr.split("-");
    if (parts.length !== 3) return null;
    y = Number(parts[0]);
    mStr = parts[1];
    dStr = parts[2];
    ymd = dateOrStr;
    md = `${mStr}-${dStr}`;
  } else {
    // Date object
    const date = dateOrStr;
    y = date.getFullYear();
    mStr = String(date.getMonth() + 1).padStart(2, "0");
    dStr = String(date.getDate()).padStart(2, "0");
    ymd = `${y}-${mStr}-${dStr}`;
    md = `${mStr}-${dStr}`;
  }

  // Fixed regional holidays (like Uttarayan / Vasi Uttarayan)
  const fixed: Record<string, Holiday> = {
    "01-14": { name: "Uttarayan", emoji: "🪁", isHoliday: true },
    "01-15": { name: "Vasi Uttarayan", emoji: "🪁", isHoliday: true },
    "05-01": { name: "Gujarat Day", emoji: "🦁", isHoliday: true },
  };

  // Variable Gujarati and Indian holidays (covering Google Calendar + local cultural holidays)
  const variableGujarati: Record<string, Holiday> = {
    // 2025
    "2025-02-26": { name: "Maha Shivratri", emoji: "🔱", isHoliday: true },
    "2025-03-14": { name: "Holi", emoji: "🎨", isHoliday: true },
    "2025-03-15": { name: "Dhuleti", emoji: "🎨", isHoliday: true },
    "2025-04-06": { name: "Ram Navami", emoji: "🏹", isHoliday: true },
    "2025-08-09": { name: "Raksha Bandhan", emoji: "🌸", isHoliday: true },
    "2025-08-16": { name: "Janmashtami", emoji: "🪈", isHoliday: true },
    "2025-08-27": { name: "Ganesh Chaturthi", emoji: "🐘", isHoliday: true },
    "2025-10-02": { name: "Dussehra", emoji: "🏹", isHoliday: true },
    "2025-10-20": { name: "Diwali", emoji: "🪔", isHoliday: true },
    "2025-10-22": { name: "Gujarati New Year", emoji: "🪔", isHoliday: true },
    "2025-10-23": { name: "Bhai Dooj", emoji: "🌸", isHoliday: true },

    // 2026
    "2026-02-15": { name: "Maha Shivratri", emoji: "🔱", isHoliday: true },
    "2026-03-03": { name: "Holi", emoji: "🎨", isHoliday: true },
    "2026-03-04": { name: "Dhuleti", emoji: "🎨", isHoliday: true },
    "2026-03-27": { name: "Ram Navami", emoji: "🏹", isHoliday: true },
    "2026-08-28": { name: "Raksha Bandhan", emoji: "🌸", isHoliday: true },
    "2026-09-04": { name: "Janmashtami", emoji: "🪈", isHoliday: true },
    "2026-09-14": { name: "Ganesh Chaturthi", emoji: "🐘", isHoliday: true },
    "2026-10-20": { name: "Dussehra", emoji: "🏹", isHoliday: true },
    "2026-11-08": { name: "Diwali", emoji: "🪔", isHoliday: true },
    "2026-11-09": { name: "Gujarati New Year", emoji: "🪔", isHoliday: true },
    "2026-11-10": { name: "Bhai Dooj", emoji: "🌸", isHoliday: true },
    
    // 2027
    "2027-03-06": { name: "Maha Shivratri", emoji: "🔱", isHoliday: true },
    "2027-03-22": { name: "Holi", emoji: "🎨", isHoliday: true },
    "2027-03-23": { name: "Dhuleti", emoji: "🎨", isHoliday: true },
    "2027-04-15": { name: "Ram Navami", emoji: "🏹", isHoliday: true },
    "2027-08-17": { name: "Raksha Bandhan", emoji: "🌸", isHoliday: true },
    "2027-08-25": { name: "Janmashtami", emoji: "🪈", isHoliday: true },
    "2027-09-04": { name: "Ganesh Chaturthi", emoji: "🐘", isHoliday: true },
    "2027-10-09": { name: "Dussehra", emoji: "🏹", isHoliday: true },
    "2027-10-29": { name: "Diwali", emoji: "🪔", isHoliday: true },
    "2027-10-30": { name: "Gujarati New Year", emoji: "🪔", isHoliday: true },
    "2027-10-31": { name: "Bhai Dooj", emoji: "🌸", isHoliday: true },
    
    // 2028
    "2028-02-24": { name: "Maha Shivratri", emoji: "🔱", isHoliday: true },
    "2028-03-10": { name: "Holi", emoji: "🎨", isHoliday: true },
    "2028-03-11": { name: "Dhuleti", emoji: "🎨", isHoliday: true },
    "2028-04-03": { name: "Ram Navami", emoji: "🏹", isHoliday: true },
    "2028-08-05": { name: "Raksha Bandhan", emoji: "🌸", isHoliday: true },
    "2028-08-13": { name: "Janmashtami", emoji: "🪈", isHoliday: true },
    "2028-09-22": { name: "Ganesh Chaturthi", emoji: "🐘", isHoliday: true },
    "2028-09-28": { name: "Dussehra", emoji: "🏹", isHoliday: true },
    "2028-10-17": { name: "Diwali", emoji: "🪔", isHoliday: true },
    "2028-10-18": { name: "Gujarati New Year", emoji: "🪔", isHoliday: true },
    "2028-10-19": { name: "Bhai Dooj", emoji: "🌸", isHoliday: true },
  };

  if (variableGujarati[ymd]) return variableGujarati[ymd];
  if (fixed[md]) return fixed[md];
  if (apiHolidays[ymd]) return apiHolidays[ymd];

  // Fallback to static values if API didn't load yet
  const staticFallback: Record<string, Holiday> = {
    "01-01": { name: "New Year", emoji: "✨", isHoliday: true },
    "01-26": { name: "Republic Day", emoji: "🇮🇳", isHoliday: true },
    "08-15": { name: "Independence Day", emoji: "🇮🇳", isHoliday: true },
    "10-02": { name: "Gandhi Jayanti", emoji: "👓", isHoliday: true },
    "12-25": { name: "Christmas", emoji: "🎄", isHoliday: true },
  };

  return staticFallback[md] || null;
}




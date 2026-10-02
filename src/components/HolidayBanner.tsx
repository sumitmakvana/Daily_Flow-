import { useState, useEffect } from "react";
import { fetchIndianHolidays, todayISO, getActiveHolidaysForDate, type Holiday, type ActiveHolidayMatch } from "@/lib/format";
import { holidaysService } from "@/services/operations";
import { useServerFn } from "@tanstack/react-start";
import { fetchActiveAnnouncements } from "@/services/announcements.functions";
import { X } from "lucide-react";
import { useLocation } from "@tanstack/react-router";
import { FestivalIllustration, getFestivalKey, type FestivalKey } from "@/components/festivalArt";

interface Announcement {
  id: string;
  title: string;
  message: string;
  emoji: string;
  theme_color: string;
  image_url?: string | null;
  start_date: string;
  end_date: string;
}

interface BannerItem {
  id: string;
  title: string;
  detail: string;
  festivalKey: FestivalKey;
  customImageUrl: string | null;
}

const SESSION_DISMISSED_KEY = "dailyflow_dismissed_festival_banners";

function getDismissedBannerIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SESSION_DISMISSED_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch (e) {}
  return new Set();
}

function saveDismissedBannerId(id: string) {
  try {
    const current = getDismissedBannerIds();
    current.add(id);
    sessionStorage.setItem(SESSION_DISMISSED_KEY, JSON.stringify(Array.from(current)));
  } catch (e) {}
}

export function HolidayBanner() {
  const location = useLocation();
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => getDismissedBannerIds());

  const fetchActiveAnnouncementsFn = useServerFn(fetchActiveAnnouncements);

  useEffect(() => {
    const todayStr = todayISO(); // "YYYY-MM-DD"
    const year = new Date().getFullYear();

    async function loadAllBanners() {
      const compiledBanners: BannerItem[] = [];
      const seenTitles = new Set<string>();

      // 1. Fetch active custom announcements set by Admin
      try {
        const dbBanners = await fetchActiveAnnouncementsFn();
        if (dbBanners && dbBanners.length > 0) {
          for (const ann of dbBanners as Announcement[]) {
            compiledBanners.push(buildCustomAnnouncementBanner(ann));
            seenTitles.add(ann.title.toLowerCase().trim());
          }
        }
      } catch (err) {
        console.warn("Failed to fetch custom announcements:", err);
      }

      // 2. Fetch automatic festival & holiday list (covering 1 working day before, day of, 1 day after)
      try {
        let apiHolidays: Record<string, Holiday> = {};
        let customHolidays: Array<{ calendar_date?: string; label?: string }> = [];
        try {
          const [api, custom] = await Promise.all([
            fetchIndianHolidays(year).catch(() => ({})),
            holidaysService.list().catch(() => []),
          ]);
          apiHolidays = api;
          customHolidays = custom;
        } catch (e) {
          apiHolidays = {};
        }

        const activeHolidays = getActiveHolidaysForDate(todayStr, apiHolidays, customHolidays);

        for (const match of activeHolidays) {
          // If custom announcement already matches this holiday name, avoid duplicate
          if (seenTitles.has(match.holiday.name.toLowerCase().trim())) continue;
          compiledBanners.push(buildHolidayBanner(match));
        }
      } catch (err) {
        console.warn("Failed to load automatic holidays:", err);
      }

      setBanners(compiledBanners);
    }

    loadAllBanners();
  }, []);

  const handleDismiss = (id: string) => {
    saveDismissedBannerId(id);
    setDismissedIds((prev) => new Set([...prev, id]));
  };

  const visibleBanners = banners.filter((b) => !dismissedIds.has(b.id));

  if (visibleBanners.length === 0) return null;

  const { maxWidth, padding } = getBannerLayout(location.pathname || "");

  return (
    <div className={`mx-auto ${maxWidth} ${padding} pt-3 space-y-2`}>
      {visibleBanners.map((banner) => (
        <div
          key={banner.id}
          role="status"
          data-festival-banner={banner.festivalKey}
          className="flex h-14 items-center gap-3 rounded-lg border border-border bg-card pl-3 pr-2 sm:pl-4"
        >
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden">
            {banner.customImageUrl ? (
              <img src={banner.customImageUrl} alt="" className="h-9 w-9 rounded-md object-cover" />
            ) : (
              <FestivalIllustration festivalKey={banner.festivalKey} size={36} />
            )}
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-x-2">
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">{banner.title}</span>
            {banner.detail && (
              <>
                <span className="hidden flex-shrink-0 text-muted-foreground sm:inline">—</span>
                <span className="flex-shrink-0 whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:text-xs">
                  {banner.detail}
                </span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => handleDismiss(banner.id)}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            aria-label="Dismiss"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Width/padding of each page's own content container, so the banner lines up with the page below it.
 * First match wins; keep more specific routes before their parents.
 */
const BANNER_LAYOUTS: Array<[string, string, string]> = [
  ["/calendar", "max-w-[1800px]", "px-4"],
  ["/time-tracking", "max-w-[1600px]", "px-4 md:px-6"],
  ["/my-day", "max-w-5xl", "px-3 md:px-6"],
  ["/today", "max-w-2xl", "px-3 md:px-4"],
  ["/sync", "max-w-2xl", "px-3 md:px-4"],
  ["/settings/notifications", "max-w-xl", "px-3 md:px-4"],
  ["/settings", "max-w-3xl", "px-3 md:px-4"],
  ["/configure/automations", "max-w-5xl", "px-3 md:px-4"],
  ["/configure/new", "max-w-3xl", "px-3 md:px-4"],
  ["/configure", "max-w-5xl", "px-3 md:px-4"],
  ["/blockers", "max-w-3xl", "px-3 md:px-4"],
  ["/eod-tasks", "max-w-3xl", "px-3 md:px-4"],
  ["/onboarding", "max-w-3xl", "px-3 md:px-4"],
  ["/admin", "max-w-4xl", "px-3 md:px-4"],
  ["/eod", "max-w-7xl", "px-3 md:px-6"],
  ["/executive", "max-w-7xl", "px-3 md:px-6"],
  ["/leaves", "max-w-7xl", "px-3 md:px-6"],
  ["/tasks", "max-w-7xl", "px-3 md:px-6"],
  ["/command", "max-w-6xl", "px-3 md:px-6"],
  ["/dashboard", "max-w-6xl", "px-3 md:px-6"],
  ["/heatmap", "max-w-6xl", "px-3 md:px-6"],
  ["/intelligence", "max-w-6xl", "px-3 md:px-6"],
  ["/manager", "max-w-6xl", "px-3 md:px-6"],
  ["/planning-suggestions", "max-w-5xl", "px-3 md:px-4"],
  ["/planning", "max-w-6xl", "px-3 md:px-6"],
  ["/exports", "max-w-6xl", "px-3 md:px-6"],
];

function getBannerLayout(pathname: string): { maxWidth: string; padding: string } {
  const match = BANNER_LAYOUTS.find(([p]) => pathname === p || pathname.startsWith(p + "/"));
  return match
    ? { maxWidth: match[1], padding: match[2] }
    : { maxWidth: "max-w-5xl", padding: "px-3 md:px-4" };
}

function buildCustomAnnouncementBanner(ann: Announcement): BannerItem {
  return {
    id: `ann_${ann.id}`,
    title: ann.title || ann.message,
    detail: ann.title && ann.message ? ann.message : "",
    festivalKey: getFestivalKey(`${ann.theme_color || ""} ${ann.title || ""}`),
    customImageUrl: ann.image_url || null,
  };
}

function buildHolidayBanner(match: ActiveHolidayMatch): BannerItem {
  const { holiday, date, status } = match;

  let detail = "Office Closed";
  if (status === "advance") {
    let when = "";
    try {
      when = new Date(date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    } catch (e) {}
    detail = when ? `Office closed ${when}` : "Office closed tomorrow";
  } else if (status === "post") {
    detail = "Office reopened";
  }

  return {
    id: `holiday_${holiday.name}_${date}`,
    title: holiday.name,
    detail,
    festivalKey: holiday.isCompanyHoliday ? "office-holiday" : getFestivalKey(holiday.name),
    customImageUrl: null,
  };
}

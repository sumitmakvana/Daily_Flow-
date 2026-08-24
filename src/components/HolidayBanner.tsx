import React, { useState, useEffect } from "react";
import { fetchIndianHolidays, todayISO, getActiveHolidaysForDate, type Holiday, type ActiveHolidayMatch } from "@/lib/format";
import { useServerFn } from "@tanstack/react-start";
import { fetchActiveAnnouncements } from "@/services/announcements.functions";
import { X } from "lucide-react";
import { useLocation } from "@tanstack/react-router";

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
  type: "custom" | "holiday";
  themeClass: string;
  message: string;
  subText: string;
  emojiVal: string;
  graphicElement: React.ReactNode;
  customImageUrl: string | null;
  isTricolor: boolean;
  themeKey: string;
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
            const item = buildCustomAnnouncementBanner(ann);
            compiledBanners.push(item);
            seenTitles.add(ann.title.toLowerCase().trim());
          }
        }
      } catch (err) {
        console.warn("Failed to fetch custom announcements:", err);
      }

      // 2. Fetch automatic festival & holiday list (covering 1 working day before, day of, 1 day after)
      try {
        let apiHolidays: Record<string, Holiday> = {};
        try {
          apiHolidays = await fetchIndianHolidays(year);
        } catch (e) {
          apiHolidays = {};
        }

        const activeHolidays = getActiveHolidaysForDate(todayStr, apiHolidays);

        for (const match of activeHolidays) {
          // If custom announcement already matches this holiday name, avoid duplicate
          const lowerName = match.holiday.name.toLowerCase().trim();
          if (seenTitles.has(lowerName)) continue;

          const item = buildHolidayBanner(match);
          compiledBanners.push(item);
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

  // Get active pathname to determine maximum width to match page layouts
  const pathname = location.pathname || "";
  let maxWidthClass = "max-w-5xl"; // default
  if (pathname.includes("/calendar")) {
    maxWidthClass = "max-w-7xl";
  } else if (pathname.includes("/today")) {
    maxWidthClass = "max-w-2xl";
  }

  return (
    <div className={`${maxWidthClass} mx-auto px-3 md:px-4 mt-3 mb-2 space-y-2.5`}>
      {visibleBanners.map((banner) => {
        const isMonsoon =
          banner.themeKey.includes("monsoon") || banner.themeKey.includes("rain");

        return (
          <div
            key={banner.id}
            className={`relative overflow-hidden bg-gradient-to-r ${banner.themeClass} px-4 py-2.5 rounded-xl shadow-md border border-white/10 flex items-center justify-between transition-all duration-300 z-30`}
          >
            {/* Decorative pulse glow */}
            <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/30 via-transparent to-transparent" />

            {/* Live Rain effect for monsoon theme */}
            {isMonsoon && (
              <>
                <style
                  dangerouslySetInnerHTML={{
                    __html: `
                    @keyframes rain-fall {
                      0% { transform: translateY(-30px) translateX(0) rotate(15deg); opacity: 0; }
                      20% { opacity: 0.6; }
                      80% { opacity: 0.6; }
                      100% { transform: translateY(110px) translateX(-20px) rotate(15deg); opacity: 0; }
                    }
                    .raindrop-live {
                      position: absolute;
                      width: 1.5px;
                      height: 15px;
                      background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(224,242,254,0.8));
                      animation: rain-fall linear infinite;
                      pointer-events: none;
                    }
                  `,
                  }}
                />
                <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-40 z-0">
                  <div className="raindrop-live" style={{ left: "5%", top: "-10px", animationDelay: "0s", animationDuration: "0.8s" }} />
                  <div className="raindrop-live" style={{ left: "15%", top: "-10px", animationDelay: "0.3s", animationDuration: "1.2s" }} />
                  <div className="raindrop-live" style={{ left: "25%", top: "-10px", animationDelay: "0.1s", animationDuration: "0.9s" }} />
                  <div className="raindrop-live" style={{ left: "35%", top: "-10px", animationDelay: "0.6s", animationDuration: "1.1s" }} />
                  <div className="raindrop-live" style={{ left: "45%", top: "-10px", animationDelay: "0.2s", animationDuration: "0.7s" }} />
                  <div className="raindrop-live" style={{ left: "55%", top: "-10px", animationDelay: "0.4s", animationDuration: "1s" }} />
                  <div className="raindrop-live" style={{ left: "65%", top: "-10px", animationDelay: "0.15s", animationDuration: "0.85s" }} />
                  <div className="raindrop-live" style={{ left: "75%", top: "-10px", animationDelay: "0.7s", animationDuration: "1.3s" }} />
                  <div className="raindrop-live" style={{ left: "85%", top: "-10px", animationDelay: "0.35s", animationDuration: "0.95s" }} />
                  <div className="raindrop-live" style={{ left: "95%", top: "-10px", animationDelay: "0.5s", animationDuration: "1.05s" }} />
                </div>
              </>
            )}

            <div className="flex-1 flex items-center justify-center gap-3 sm:gap-4 text-left max-w-5xl mx-auto z-10 relative py-0.5">
              <div className="flex-shrink-0 drop-shadow-sm">
                {banner.customImageUrl ? (
                  <img
                    src={banner.customImageUrl}
                    alt={banner.message}
                    className="w-12 h-9 object-cover rounded border border-white/20"
                  />
                ) : (
                  banner.graphicElement
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span
                  className={`text-xs sm:text-sm font-semibold tracking-wide leading-normal ${
                    banner.isTricolor ? "text-blue-950" : "text-white"
                  }`}
                >
                  {banner.message}
                </span>
                <span
                  className={`text-[10px] sm:text-[11px] font-medium mt-0.5 opacity-90 ${
                    banner.isTricolor ? "text-blue-900/85" : "text-white/85"
                  }`}
                >
                  {banner.subText}
                </span>
              </div>
            </div>

            <button
              onClick={() => handleDismiss(banner.id)}
              className={`flex-shrink-0 rounded-full p-1.5 transition-colors cursor-pointer ml-3 z-10 relative ${
                banner.isTricolor
                  ? "text-blue-950 hover:bg-black/10"
                  : "text-white/80 hover:text-white hover:bg-white/15"
              }`}
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function buildCustomAnnouncementBanner(ann: Announcement): BannerItem {
  const themeKey = (ann.theme_color || "").toLowerCase();
  let themeClass = "from-indigo-600 via-purple-600 to-pink-600 text-white";
  let isTricolor = themeKey === "tricolor";

  let graphicElement: React.ReactNode = (
    <span className="text-2xl">{ann.emoji || "📢"}</span>
  );

  if (themeKey.includes("diwali")) {
    themeClass = "from-amber-700 via-orange-600 to-yellow-600 text-white shadow-[0_4px_20px_rgba(235,130,10,0.25)]";
    graphicElement = (
      <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none">
        <path d="M15,50 C15,75 35,85 50,85 C65,85 85,75 85,50 C85,50 75,55 50,55 C25,55 15,50 15,50 Z" fill="#b45309" stroke="#fff" strokeWidth="1" />
        <path d="M22,51 C22,68 35,76 50,76 C65,76 78,68 78,51 C78,51 68,54 50,54 C32,54 22,51 22,51 Z" fill="#d97706" />
        <path d="M50,15 C55,30 62,38 58,52 C54,66 46,66 42,52 C38,38 45,30 50,15 Z" fill="#f59e0b" className="animate-bounce origin-bottom" style={{ animationDuration: "1.5s" }} />
        <path d="M50,25 C53,35 57,40 55,48 C53,56 47,56 45,48 C43,40 47,35 50,25 Z" fill="#ef4444" className="animate-pulse origin-bottom" style={{ animationDuration: "1s" }} />
      </svg>
    );
  } else if (themeKey.includes("new year")) {
    themeClass = "from-zinc-950 via-purple-950 to-indigo-950 text-white border-b border-amber-500/20";
    graphicElement = (
      <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none">
        <circle cx="50" cy="50" r="3" fill="#ffd700" className="animate-ping" style={{ animationDuration: "1s" }} />
        <line x1="50" y1="50" x2="50" y2="15" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
        <line x1="50" y1="50" x2="50" y2="85" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
        <line x1="50" y1="50" x2="15" y2="50" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
        <line x1="50" y1="50" x2="85" y2="50" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
      </svg>
    );
  } else if (themeKey.includes("uttarayan") || themeKey.includes("sankranti")) {
    themeClass = "from-sky-500 via-blue-600 to-indigo-600 text-white";
    graphicElement = (
      <svg className="w-10 h-10 animate-bounce" style={{ animationDuration: "4s" }} viewBox="0 0 100 100" fill="none">
        <path d="M50,10 L80,42 L50,74 L20,42 Z" fill="#ec4899" stroke="#ffffff" strokeWidth="2" />
        <path d="M50,10 L50,74" stroke="#ffffff" strokeWidth="1.5" />
        <path d="M20,42 Q50,56 80,42" stroke="#ffffff" strokeWidth="1.5" fill="none" />
        <path d="M50,74 L55,83 L50,91" stroke="#f59e0b" strokeWidth="2" fill="none" />
      </svg>
    );
  } else if (themeKey.includes("gandhi")) {
    themeClass = "from-emerald-800 via-teal-700 to-emerald-700 text-white";
    graphicElement = (
      <svg className="w-10 h-10 opacity-90 text-white" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3">
        <circle cx="32" cy="50" r="14" />
        <circle cx="68" cy="50" r="14" />
        <path d="M46,50 L54,50" />
      </svg>
    );
  } else if (themeKey.includes("tricolor") || themeKey.includes("republic") || themeKey.includes("independence")) {
    themeClass = "from-orange-600 via-zinc-100 to-green-700 text-foreground border-b border-border shadow-[0_2px_10px_rgba(0,0,0,0.05)]";
    isTricolor = true;
    graphicElement = (
      <svg className="w-10 h-10 animate-spin" style={{ animationDuration: "40s" }} viewBox="0 0 100 100" fill="none" stroke="#1e3a8a">
        <circle cx="50" cy="50" r="30" strokeWidth="3" />
        <circle cx="50" cy="50" r="5" fill="#1e3a8a" />
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = (i * 360) / 24;
          const rad = (angle * Math.PI) / 180;
          const x2 = 50 + 30 * Math.cos(rad);
          const y2 = 50 + 30 * Math.sin(rad);
          return <line key={i} x1="50" y1="50" x2={x2} y2={y2} strokeWidth="1.5" />;
        })}
      </svg>
    );
  } else if (themeKey.includes("holi") || themeKey.includes("dhuleti")) {
    themeClass = "from-pink-500 via-purple-500 to-orange-500 text-white";
    graphicElement = (
      <svg className="w-10 h-10 opacity-95 animate-spin" style={{ animationDuration: "25s" }} viewBox="0 0 100 100" fill="none">
        <circle cx="28" cy="28" r="9" fill="#ec4899" />
        <circle cx="72" cy="28" r="11" fill="#a855f7" />
        <circle cx="35" cy="72" r="13" fill="#3b82f6" />
        <circle cx="68" cy="68" r="8" fill="#f97316" />
      </svg>
    );
  } else if (themeKey.includes("christmas")) {
    themeClass = "from-red-700 via-emerald-600 to-emerald-800 text-white";
    graphicElement = (
      <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth="2.5">
        <path d="M50,15 L78,55 L65,55 L83,80 L17,80 L35,55 L22,55 Z" fill="#15803d" />
        <rect x="45" y="80" width="10" height="12" fill="#78350f" stroke="none" />
      </svg>
    );
  } else if (themeKey.includes("monsoon") || themeKey.includes("rain")) {
    themeClass = "from-cyan-700 via-sky-600 to-blue-700 text-white shadow-[0_4px_20px_rgba(14,165,233,0.25)]";
    graphicElement = (
      <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none">
        <path d="M30,65 C20,65 15,55 22,47 C18,35 32,25 45,30 C52,20 70,22 75,35 C85,35 88,48 78,57 C82,65 70,65 65,65 Z" fill="#e2e8f0" stroke="#fff" strokeWidth="2" />
        <line x1="38" y1="70" x2="34" y2="82" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" className="animate-pulse" style={{ animationDuration: "0.8s" }} />
        <line x1="50" y1="73" x2="46" y2="85" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" className="animate-pulse" style={{ animationDuration: "1.2s" }} />
        <line x1="62" y1="70" x2="58" y2="82" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" className="animate-pulse" style={{ animationDuration: "1s" }} />
      </svg>
    );
  }

  return {
    id: `ann_${ann.id}`,
    type: "custom",
    themeClass,
    message: ann.message,
    subText: `Announcing: ${ann.title}`,
    emojiVal: ann.emoji || "📢",
    graphicElement,
    customImageUrl: ann.image_url || null,
    isTricolor,
    themeKey,
  };
}

function buildHolidayBanner(match: ActiveHolidayMatch): BannerItem {
  const { holiday, date, status } = match;
  const nameLower = holiday.name.toLowerCase();

  let themeClass = "from-indigo-600 via-purple-600 to-pink-600 text-white";
  let message = `Wishing you a happy and joyful ${holiday.name}! 🕊️`;
  const emojiVal = holiday.emoji || "🗓️";
  let isTricolor = nameLower.includes("independence") || nameLower.includes("republic");

  let graphicElement: React.ReactNode = (
    <svg className="w-9 h-9 animate-pulse text-white/95" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3">
      <circle cx="50" cy="50" r="30" />
      <path d="M50,20 L50,80 M20,50 L80,50" />
    </svg>
  );

  if (nameLower.includes("diwali") || nameLower.includes("deepavali")) {
    themeClass = "from-amber-700 via-orange-600 to-yellow-600 text-white shadow-[0_4px_20px_rgba(235,130,10,0.25)]";
    message = "Wishing you a Happy, Prosperous and Joyful Diwali! May this festival of lights fill your life with warmth. 🪔";
    graphicElement = (
      <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none">
        <path d="M15,50 C15,75 35,85 50,85 C65,85 85,75 85,50 C85,50 75,55 50,55 C25,55 15,50 15,50 Z" fill="#b45309" stroke="#fff" strokeWidth="1" />
        <path d="M22,51 C22,68 35,76 50,76 C65,76 78,68 78,51 C78,51 68,54 50,54 C32,54 22,51 22,51 Z" fill="#d97706" />
        <path d="M50,15 C55,30 62,38 58,52 C54,66 46,66 42,52 C38,38 45,30 50,15 Z" fill="#f59e0b" className="animate-bounce origin-bottom" style={{ animationDuration: "1.5s" }} />
        <path d="M50,25 C53,35 57,40 55,48 C53,56 47,56 45,48 C43,40 47,35 50,25 Z" fill="#ef4444" className="animate-pulse origin-bottom" style={{ animationDuration: "1s" }} />
      </svg>
    );
  } else if (nameLower.includes("new year")) {
    themeClass = "from-zinc-950 via-purple-950 to-indigo-950 text-white border border-amber-500/30";
    message = nameLower.includes("gujarati")
      ? "Nutan Varshabhinandan & Happy New Year! Wishing you 365 days of joy, growth, success, and prosperity. ✨"
      : "Happy New Year! Wishing you 365 days of joy, growth, success, and outstanding milestones. ✨";
    graphicElement = (
      <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none">
        <circle cx="50" cy="50" r="3" fill="#ffd700" className="animate-ping" style={{ animationDuration: "1s" }} />
        <line x1="50" y1="50" x2="50" y2="15" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
        <line x1="50" y1="50" x2="50" y2="85" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
        <line x1="50" y1="50" x2="15" y2="50" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
        <line x1="50" y1="50" x2="85" y2="50" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
      </svg>
    );
  } else if (nameLower.includes("bhai dooj") || nameLower.includes("bhai beej") || nameLower.includes("bhai")) {
    themeClass = "from-rose-700 via-pink-600 to-amber-600 text-white shadow-[0_4px_20px_rgba(244,63,94,0.25)]";
    message = "Happy Bhai Dooj! Celebrating the special bond of love, protection, and lifelong togetherness. 🌸";
    graphicElement = (
      <svg className="w-10 h-10 animate-pulse" viewBox="0 0 100 100" fill="none">
        <circle cx="50" cy="50" r="28" fill="#fda4af" />
        <circle cx="50" cy="50" r="16" fill="#fb7185" />
        <circle cx="50" cy="50" r="7" fill="#e11d48" />
      </svg>
    );
  } else if (nameLower.includes("uttarayan") || nameLower.includes("sankranti")) {
    themeClass = "from-sky-400 via-blue-500 to-indigo-500 text-white";
    message = nameLower.includes("vasi")
      ? "Happy Vasi Uttarayan! Let the festive spirit and kites fly high in the bright sky. 🪁"
      : "Happy Uttarayan! May your dreams and business milestones fly high like a kite in the wind. 🪁";
    graphicElement = (
      <svg className="w-10 h-10 animate-bounce" style={{ animationDuration: "4s" }} viewBox="0 0 100 100" fill="none">
        <path d="M50,10 L80,42 L50,74 L20,42 Z" fill="#ec4899" stroke="#ffffff" strokeWidth="2" />
        <path d="M50,10 L50,74" stroke="#ffffff" strokeWidth="1.5" />
        <path d="M20,42 Q50,56 80,42" stroke="#ffffff" strokeWidth="1.5" fill="none" />
        <path d="M50,74 L55,83 L50,91" stroke="#f59e0b" strokeWidth="2" fill="none" />
      </svg>
    );
  } else if (nameLower.includes("shivratri")) {
    themeClass = "from-slate-900 via-indigo-950 to-cyan-950 text-white border border-cyan-500/30";
    message = "Happy Maha Shivratri! May the divine blessings of Lord Shiva bring peace, strength, and enlightenment. 🔱";
    graphicElement = (
      <svg className="w-10 h-10 animate-pulse" viewBox="0 0 100 100" fill="none" stroke="#38bdf8" strokeWidth="2.5">
        <path d="M50,20 L50,85" />
        <path d="M30,30 Q30,55 50,55 Q70,55 70,30" />
        <circle cx="50" cy="18" r="4" fill="#38bdf8" />
      </svg>
    );
  } else if (nameLower.includes("gandhi")) {
    themeClass = "from-emerald-800 via-teal-700 to-emerald-700 text-white";
    message = 'Happy Gandhi Jayanti! "In a gentle way, you can shake the world." 🕊️';
    graphicElement = (
      <svg className="w-10 h-10 opacity-90 text-white" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3">
        <circle cx="32" cy="50" r="14" />
        <circle cx="68" cy="50" r="14" />
        <path d="M46,50 L54,50" />
      </svg>
    );
  } else if (nameLower.includes("independence") || nameLower.includes("republic") || nameLower.includes("gujarat day")) {
    themeClass = "from-orange-600 via-zinc-100 to-green-700 text-foreground border-b border-border shadow-[0_2px_10px_rgba(0,0,0,0.05)]";
    isTricolor = true;
    message = `Happy ${holiday.name}! Saluting the spirit of freedom, unity, and progress. 🇮🇳`;
    graphicElement = (
      <svg className="w-10 h-10 animate-spin" style={{ animationDuration: "40s" }} viewBox="0 0 100 100" fill="none" stroke="#1e3a8a">
        <circle cx="50" cy="50" r="30" strokeWidth="3" />
        <circle cx="50" cy="50" r="5" fill="#1e3a8a" />
        {Array.from({ length: 24 }).map((_, i) => {
          const angle = (i * 360) / 24;
          const rad = (angle * Math.PI) / 180;
          const x2 = 50 + 30 * Math.cos(rad);
          const y2 = 50 + 30 * Math.sin(rad);
          return <line key={i} x1="50" y1="50" x2={x2} y2={y2} strokeWidth="1.5" />;
        })}
      </svg>
    );
  } else if (nameLower.includes("holi") || nameLower.includes("dhuleti")) {
    themeClass = "from-pink-500 via-purple-500 to-orange-500 text-white";
    message = nameLower.includes("dhuleti")
      ? "Happy Dhuleti! Celebrating the festival of colors with happiness, harmony, and togetherness. 🎨"
      : "Wishing you a colorful, vibrant, and joyful Holi! Let the colors bring positive vibes. 🎨";
    graphicElement = (
      <svg className="w-10 h-10 opacity-95 animate-spin" style={{ animationDuration: "25s" }} viewBox="0 0 100 100" fill="none">
        <circle cx="28" cy="28" r="9" fill="#ec4899" />
        <circle cx="72" cy="28" r="11" fill="#a855f7" />
        <circle cx="35" cy="72" r="13" fill="#3b82f6" />
        <circle cx="68" cy="68" r="8" fill="#f97316" />
      </svg>
    );
  } else if (nameLower.includes("raksha") || nameLower.includes("rakhi")) {
    themeClass = "from-pink-700 via-rose-600 to-amber-600 text-white shadow-[0_4px_20px_rgba(225,29,72,0.25)]";
    message = "Happy Raksha Bandhan! Celebrating the eternal bond of affection, trust, and care. 🌸";
    graphicElement = (
      <svg className="w-10 h-10 animate-pulse" viewBox="0 0 100 100" fill="none">
        <circle cx="50" cy="50" r="24" fill="#fb7185" stroke="#fff" strokeWidth="2" />
        <circle cx="50" cy="50" r="14" fill="#fbbf24" />
        <line x1="15" y1="50" x2="85" y2="50" stroke="#f43f5e" strokeWidth="3" strokeDasharray="4,4" />
      </svg>
    );
  } else if (nameLower.includes("janmashtami") || nameLower.includes("krishna")) {
    themeClass = "from-blue-900 via-indigo-800 to-teal-700 text-white shadow-[0_4px_20px_rgba(59,130,246,0.25)]";
    message = "Happy Krishna Janmashtami! May Lord Krishna bless your life with divine joy, harmony, and wisdom. 🪈";
    graphicElement = (
      <svg className="w-10 h-10 animate-bounce" style={{ animationDuration: "3s" }} viewBox="0 0 100 100" fill="none">
        <path d="M20,60 Q50,20 80,40 Q60,70 20,60 Z" fill="#06b6d4" />
        <circle cx="60" cy="38" r="8" fill="#3b82f6" />
        <circle cx="60" cy="38" r="4" fill="#fbbf24" />
      </svg>
    );
  } else if (nameLower.includes("ganesh")) {
    themeClass = "from-orange-700 via-amber-600 to-yellow-600 text-white shadow-[0_4px_20px_rgba(234,88,12,0.25)]";
    message = "Ganpati Bappa Morya! Wishing you a Happy Ganesh Chaturthi. May Lord Ganesha remove all hurdles. 🐘";
    graphicElement = (
      <svg className="w-10 h-10 animate-pulse" viewBox="0 0 100 100" fill="none">
        <circle cx="50" cy="50" r="26" fill="#f97316" stroke="#fff" strokeWidth="2" />
        <path d="M50,30 Q60,50 50,70 Q40,55 50,45" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  } else if (nameLower.includes("dussehra") || nameLower.includes("dasara") || nameLower.includes("navratri")) {
    themeClass = "from-red-800 via-orange-700 to-amber-600 text-white shadow-[0_4px_20px_rgba(220,38,38,0.25)]";
    message = "Happy Dussehra & Vijayadashami! Celebrating the glorious victory of good over evil. 🏹";
    graphicElement = (
      <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth="3">
        <path d="M25,20 Q65,50 25,80" strokeLinecap="round" />
        <line x1="20" y1="50" x2="80" y2="50" stroke="#fde047" strokeWidth="3" />
        <path d="M70,40 L85,50 L70,60" fill="#fde047" stroke="none" />
      </svg>
    );
  } else if (nameLower.includes("ram navami")) {
    themeClass = "from-amber-600 via-orange-600 to-red-600 text-white shadow-[0_4px_20px_rgba(249,115,22,0.25)]";
    message = "Happy Ram Navami! May righteousness, peace, and divine prosperity illuminate your life. 🏹";
    graphicElement = (
      <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth="3">
        <path d="M25,20 Q65,50 25,80" strokeLinecap="round" />
        <line x1="20" y1="50" x2="80" y2="50" stroke="#fde047" strokeWidth="3" />
        <path d="M70,40 L85,50 L70,60" fill="#fde047" stroke="none" />
      </svg>
    );
  } else if (nameLower.includes("christmas")) {
    themeClass = "from-red-700 via-emerald-600 to-emerald-800 text-white";
    message = "Merry Christmas! May your holiday season be filled with joy, peace, and warmth. 🎄";
    graphicElement = (
      <svg className="w-10 h-10" viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth="2.5">
        <path d="M50,15 L78,55 L65,55 L83,80 L17,80 L35,55 L22,55 Z" fill="#15803d" />
        <rect x="45" y="80" width="10" height="12" fill="#78350f" stroke="none" />
      </svg>
    );
  } else if (nameLower.includes("eid") || nameLower.includes("ramadan") || nameLower.includes("bakrid")) {
    themeClass = "from-emerald-900 via-teal-800 to-amber-700 text-white shadow-[0_4px_20px_rgba(5,150,105,0.25)]";
    message = "Eid Mubarak! Wishing you and your family happiness, peace, and prosperity. 🌙";
    graphicElement = (
      <svg className="w-10 h-10 animate-pulse" viewBox="0 0 100 100" fill="none">
        <path d="M60,20 C40,20 25,35 25,55 C25,75 40,90 60,90 C45,80 40,65 40,55 C40,45 45,30 60,20 Z" fill="#fbbf24" />
        <polygon points="70,35 73,42 80,42 75,47 77,54 70,50 63,54 65,47 60,42 67,42" fill="#fff" />
      </svg>
    );
  }

  // Subtext based on relative status
  let subText = "Noesis Analytics wishes you and your team a wonderful holiday!";
  if (status === "advance") {
    try {
      const festivalDate = new Date(date + "T00:00:00");
      const formattedDate = festivalDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      subText = `Upcoming Festival (${formattedDate}) • Noesis Analytics wishes you in advance!`;
    } catch (e) {
      subText = "Upcoming Festival • Noesis Analytics wishes you in advance!";
    }
  } else if (status === "post") {
    subText = `Noesis Analytics hopes you had a wonderful ${holiday.name} celebration!`;
  }

  return {
    id: `holiday_${holiday.name}_${date}`,
    type: "holiday",
    themeClass,
    message,
    subText,
    emojiVal,
    graphicElement,
    customImageUrl: null,
    isTricolor,
    themeKey: nameLower,
  };
}

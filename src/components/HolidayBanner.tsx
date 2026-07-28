import React, { useState, useEffect } from "react";
import { getLocalHoliday, fetchIndianHolidays, todayISO, type Holiday } from "@/lib/format";
import { useServerFn } from "@tanstack/react-start";
import { fetchActiveAnnouncements } from "@/services/announcements.functions";
import { X } from "lucide-react";

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

export function HolidayBanner() {
  const [holiday, setHoliday] = useState<Holiday | null>(null);
  const [customAnnouncement, setCustomAnnouncement] = useState<Announcement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const fetchActiveAnnouncementsFn = useServerFn(fetchActiveAnnouncements);

  useEffect(() => {
    const todayStr = todayISO(); // "YYYY-MM-DD"
    const year = new Date().getFullYear();

    async function loadBanner() {
      try {
        // 1. Check if there is an active custom announcement set by Admin for today
        const dbBanners = await fetchActiveAnnouncementsFn();

        if (dbBanners && dbBanners.length > 0) {
          const activeAnn = dbBanners[0] as Announcement;
          setCustomAnnouncement(activeAnn);
          setIsVisible(true);
          return; // Exit early: custom announcements override automatic holidays
        }
      } catch (err) {
        console.warn("Failed to fetch custom announcements:", err);
      }

      // 2. Fallback: Check automatic national/regional holiday lists
      try {
        const apiHolidays = await fetchIndianHolidays(year);
        const currentHoliday = getLocalHoliday(todayStr, apiHolidays);
        if (currentHoliday && currentHoliday.isHoliday) {
          setHoliday(currentHoliday);
          setIsVisible(true);
        }
      } catch (e) {
        const currentHoliday = getLocalHoliday(todayStr, {});
        if (currentHoliday && currentHoliday.isHoliday) {
          setHoliday(currentHoliday);
          setIsVisible(true);
        }
      }
    }

    loadBanner();
  }, []);

  if (!isVisible || (!holiday && !customAnnouncement)) return null;

  const handleDismiss = () => {
    setIsVisible(false);
  };

  // Render variables mapping
  let themeClass = "from-indigo-600 via-purple-600 to-pink-600 text-white";
  let message = "";
  let subText = "Noesis Analytics wishes you and your team a wonderful holiday!";
  let emojiVal = "🗓️";
  let graphicElement: React.ReactNode = null;
  let customImageUrl: string | null = null;
  let isTricolor = false;

  if (customAnnouncement) {
    message = customAnnouncement.message;
    subText = customAnnouncement.title;
    emojiVal = customAnnouncement.emoji || "📢";
    customImageUrl = customAnnouncement.image_url || null;
    isTricolor = customAnnouncement.theme_color === "tricolor";

    const themeKey = customAnnouncement.theme_color.toLowerCase();
    
    // Default graphic is just the bounce emoji
    graphicElement = (
      <span className="text-2xl animate-bounce">{emojiVal}</span>
    );

    if (themeKey.includes("diwali")) {
      themeClass = "from-amber-700 via-orange-600 to-yellow-600 text-white shadow-[0_4px_20px_rgba(235,130,10,0.25)]";
      graphicElement = (
        <svg className="w-14 h-14" viewBox="0 0 100 100" fill="none">
          <path d="M15,50 C15,75 35,85 50,85 C65,85 85,75 85,50 C85,50 75,55 50,55 C25,55 15,50 15,50 Z" fill="#b45309" stroke="#fff" strokeWidth="1" />
          <path d="M22,51 C22,68 35,76 50,76 C65,76 78,68 78,51 C78,51 68,54 50,54 C32,54 22,51 22,51 Z" fill="#d97706" />
          <path d="M50,15 C55,30 62,38 58,52 C54,66 46,66 42,52 C38,38 45,30 50,15 Z" fill="#f59e0b" className="animate-bounce origin-bottom" style={{ animationDuration: '1.5s' }} />
          <path d="M50,25 C53,35 57,40 55,48 C53,56 47,56 45,48 C43,40 47,35 50,25 Z" fill="#ef4444" className="animate-pulse origin-bottom" style={{ animationDuration: '1s' }} />
        </svg>
      );
    } else if (themeKey.includes("new year")) {
      themeClass = "from-zinc-950 via-purple-950 to-indigo-950 text-white border-b border-white/10";
      graphicElement = (
        <svg className="w-14 h-14" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="3" fill="#ffd700" className="animate-ping" style={{ animationDuration: '1s' }} />
          <line x1="50" y1="50" x2="50" y2="15" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
          <line x1="50" y1="50" x2="50" y2="85" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
          <line x1="50" y1="50" x2="15" y2="50" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
          <line x1="50" y1="50" x2="85" y2="50" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
        </svg>
      );
    } else if (themeKey.includes("uttarayan")) {
      themeClass = "from-sky-400 via-blue-500 to-indigo-500 text-white";
      graphicElement = (
        <svg className="w-14 h-14 animate-bounce" style={{ animationDuration: '4s' }} viewBox="0 0 100 100" fill="none">
          <path d="M50,10 L80,42 L50,74 L20,42 Z" fill="#ec4899" stroke="#ffffff" strokeWidth="2" />
          <path d="M50,10 L50,74" stroke="#ffffff" strokeWidth="1.5" />
          <path d="M20,42 Q50,56 80,42" stroke="#ffffff" strokeWidth="1.5" fill="none" />
          <path d="M50,74 L55,83 L50,91" stroke="#f59e0b" strokeWidth="2" fill="none" />
        </svg>
      );
    } else if (themeKey.includes("gandhi")) {
      themeClass = "from-emerald-800 via-teal-700 to-emerald-700 text-white";
      graphicElement = (
        <svg className="w-14 h-14 opacity-90 text-white" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3">
          <circle cx="32" cy="50" r="14" />
          <circle cx="68" cy="50" r="14" />
          <path d="M46,50 L54,50" />
        </svg>
      );
    } else if (themeKey.includes("tricolor") || themeKey.includes("republic") || themeKey.includes("independence")) {
      themeClass = "from-orange-600 via-zinc-100 to-green-700 text-foreground border-b border-border shadow-[0_2px_10px_rgba(0,0,0,0.05)]";
      isTricolor = true;
      graphicElement = (
        <svg className="w-14 h-14 animate-spin" style={{ animationDuration: '40s' }} viewBox="0 0 100 100" fill="none" stroke="#1e3a8a">
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
    } else if (themeKey.includes("holi")) {
      themeClass = "from-pink-500 via-purple-500 to-orange-500 text-white";
      graphicElement = (
        <svg className="w-14 h-14 opacity-95 animate-spin" style={{ animationDuration: '25s' }} viewBox="0 0 100 100" fill="none">
          <circle cx="28" cy="28" r="9" fill="#ec4899" />
          <circle cx="72" cy="28" r="11" fill="#a855f7" />
          <circle cx="35" cy="72" r="13" fill="#3b82f6" />
          <circle cx="68" cy="68" r="8" fill="#f97316" />
        </svg>
      );
    } else if (themeKey.includes("christmas")) {
      themeClass = "from-red-700 via-emerald-600 to-emerald-800 text-white";
      graphicElement = (
        <svg className="w-14 h-14" viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth="2.5">
          <path d="M50,15 L78,55 L65,55 L83,80 L17,80 L35,55 L22,55 Z" fill="#15803d" />
          <rect x="45" y="80" width="10" height="12" fill="#78350f" stroke="none" />
        </svg>
      );
    } else if (themeKey.includes("monsoon") || themeKey.includes("rain")) {
      themeClass = "from-cyan-700 via-sky-600 to-blue-700 text-white shadow-[0_4px_20px_rgba(14,165,233,0.25)]";
      graphicElement = (
        <svg className="w-14 h-14" viewBox="0 0 100 100" fill="none">
          <path d="M30,65 C20,65 15,55 22,47 C18,35 32,25 45,30 C52,20 70,22 75,35 C85,35 88,48 78,57 C82,65 70,65 65,65 Z" fill="#e2e8f0" stroke="#fff" strokeWidth="2" />
          <line x1="38" y1="70" x2="34" y2="82" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" className="animate-pulse" style={{ animationDuration: '0.8s' }} />
          <line x1="50" y1="73" x2="46" y2="85" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" className="animate-pulse" style={{ animationDuration: '1.2s' }} />
          <line x1="62" y1="70" x2="58" y2="82" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" className="animate-pulse" style={{ animationDuration: '1s' }} />
        </svg>
      );
    }
  } else if (holiday) {
    const nameLower = holiday.name.toLowerCase();
    message = `Wishing you a happy and peaceful ${holiday.name}! 🕊️`;
    emojiVal = holiday.emoji || "🗓️";
    isTricolor = nameLower.includes("independence") || nameLower.includes("republic");

    // Standard fallback doodles
    graphicElement = (
      <svg className="w-12 h-12 animate-pulse text-white/95" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3">
        <circle cx="50" cy="50" r="30" />
        <path d="M50,20 L50,80 M20,50 L80,50" />
      </svg>
    );

    if (nameLower.includes("diwali") || nameLower.includes("deepavali")) {
      themeClass = "from-amber-700 via-orange-600 to-yellow-600 text-white shadow-[0_4px_20px_rgba(235,130,10,0.25)]";
      message = `Wishing you a Happy, Prosperous and Joyful Diwali! May this festival of lights fill your life with warmth. 🪔`;
      graphicElement = (
        <svg className="w-14 h-14" viewBox="0 0 100 100" fill="none">
          <path d="M15,50 C15,75 35,85 50,85 C65,85 85,75 85,50 C85,50 75,55 50,55 C25,55 15,50 15,50 Z" fill="#b45309" stroke="#fff" strokeWidth="1" />
          <path d="M22,51 C22,68 35,76 50,76 C65,76 78,68 78,51 C78,51 68,54 50,54 C32,54 22,51 22,51 Z" fill="#d97706" />
          <path d="M50,15 C55,30 62,38 58,52 C54,66 46,66 42,52 C38,38 45,30 50,15 Z" fill="#f59e0b" className="animate-bounce origin-bottom" style={{ animationDuration: '1.5s' }} />
          <path d="M50,25 C53,35 57,40 55,48 C53,56 47,56 45,48 C43,40 47,35 50,25 Z" fill="#ef4444" className="animate-pulse origin-bottom" style={{ animationDuration: '1s' }} />
        </svg>
      );
    } else if (nameLower.includes("new year")) {
      themeClass = "from-zinc-950 via-purple-950 to-indigo-950 text-white border-b border-white/10";
      message = `Happy New Year! Wishing you 365 days of joy, growth, success, and outstanding milestones. ✨`;
      graphicElement = (
        <svg className="w-14 h-14" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="3" fill="#ffd700" className="animate-ping" style={{ animationDuration: '1s' }} />
          <line x1="50" y1="50" x2="50" y2="15" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
          <line x1="50" y1="50" x2="50" y2="85" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
          <line x1="50" y1="50" x2="15" y2="50" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
          <line x1="50" y1="50" x2="85" y2="50" stroke="#ffd700" strokeWidth="2.5" strokeDasharray="3,3" />
        </svg>
      );
    } else if (nameLower.includes("uttarayan") || nameLower.includes("sankranti")) {
      themeClass = "from-sky-400 via-blue-500 to-indigo-500 text-white";
      message = `Happy Uttarayan! May your dreams and business milestones fly high like a kite in the wind. 🪁`;
      graphicElement = (
        <svg className="w-14 h-14 animate-bounce" style={{ animationDuration: '4s' }} viewBox="0 0 100 100" fill="none">
          <path d="M50,10 L80,42 L50,74 L20,42 Z" fill="#ec4899" stroke="#ffffff" strokeWidth="2" />
          <path d="M50,10 L50,74" stroke="#ffffff" strokeWidth="1.5" />
          <path d="M20,42 Q50,56 80,42" stroke="#ffffff" strokeWidth="1.5" fill="none" />
          <path d="M50,74 L55,83 L50,91" stroke="#f59e0b" strokeWidth="2" fill="none" />
        </svg>
      );
    } else if (nameLower.includes("gandhi")) {
      themeClass = "from-emerald-800 via-teal-700 to-emerald-700 text-white";
      message = `Happy Gandhi Jayanti! "In a gentle way, you can shake the world." 🕊️`;
      graphicElement = (
        <svg className="w-14 h-14 opacity-90 text-white" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="3">
          <circle cx="32" cy="50" r="14" />
          <circle cx="68" cy="50" r="14" />
          <path d="M46,50 L54,50" />
        </svg>
      );
    } else if (nameLower.includes("independence") || nameLower.includes("republic") || nameLower.includes("gujarat day")) {
      themeClass = "from-orange-600 via-zinc-100 to-green-700 text-foreground border-b border-border shadow-[0_2px_10px_rgba(0,0,0,0.05)]";
      graphicElement = (
        <svg className="w-14 h-14 animate-spin" style={{ animationDuration: '40s' }} viewBox="0 0 100 100" fill="none" stroke="#1e3a8a">
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
      message = `Wishing you a colorful, vibrant, and joyful Holi! Let the colors bring positive vibes. 🎨`;
      graphicElement = (
        <svg className="w-14 h-14 opacity-95 animate-spin" style={{ animationDuration: '25s' }} viewBox="0 0 100 100" fill="none">
          <circle cx="28" cy="28" r="9" fill="#ec4899" />
          <circle cx="72" cy="28" r="11" fill="#a855f7" />
          <circle cx="35" cy="72" r="13" fill="#3b82f6" />
          <circle cx="68" cy="68" r="8" fill="#f97316" />
        </svg>
      );
    } else if (nameLower.includes("christmas")) {
      themeClass = "from-red-700 via-emerald-600 to-emerald-800 text-white";
      message = `Merry Christmas! May your holiday season be filled with joy, peace, and warmth. 🎄`;
      graphicElement = (
        <svg className="w-14 h-14" viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth="2.5">
          <path d="M50,15 L78,55 L65,55 L83,80 L17,80 L35,55 L22,55 Z" fill="#15803d" />
          <rect x="45" y="80" width="10" height="12" fill="#78350f" stroke="none" />
        </svg>
      );
    }
  }

  return (
    <div className={`relative overflow-hidden bg-gradient-to-r ${themeClass} px-5 py-4 shadow-md flex items-center justify-between transition-all duration-300 z-30`}>
      {/* Decorative pulse glow */}
      <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-white/30 via-transparent to-transparent" />
      
      {/* Live Rain effect for monsoon theme */}
      {(customAnnouncement?.theme_color.toLowerCase().includes("monsoon") || 
        customAnnouncement?.theme_color.toLowerCase().includes("rain")) && (
        <>
          <style dangerouslySetInnerHTML={{ __html: `
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
          `}} />
          <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-40 z-0">
            <div className="raindrop-live" style={{ left: '5%', top: '-10px', animationDelay: '0s', animationDuration: '0.8s' }} />
            <div className="raindrop-live" style={{ left: '15%', top: '-10px', animationDelay: '0.3s', animationDuration: '1.2s' }} />
            <div className="raindrop-live" style={{ left: '25%', top: '-10px', animationDelay: '0.1s', animationDuration: '0.9s' }} />
            <div className="raindrop-live" style={{ left: '35%', top: '-10px', animationDelay: '0.6s', animationDuration: '1.1s' }} />
            <div className="raindrop-live" style={{ left: '45%', top: '-10px', animationDelay: '0.2s', animationDuration: '0.7s' }} />
            <div className="raindrop-live" style={{ left: '55%', top: '-10px', animationDelay: '0.4s', animationDuration: '1s' }} />
            <div className="raindrop-live" style={{ left: '65%', top: '-10px', animationDelay: '0.15s', animationDuration: '0.85s' }} />
            <div className="raindrop-live" style={{ left: '75%', top: '-10px', animationDelay: '0.7s', animationDuration: '1.3s' }} />
            <div className="raindrop-live" style={{ left: '85%', top: '-10px', animationDelay: '0.35s', animationDuration: '0.95s' }} />
            <div className="raindrop-live" style={{ left: '95%', top: '-10px', animationDelay: '0.5s', animationDuration: '1.05s' }} />
          </div>
        </>
      )}

      <div className="flex-1 flex items-center justify-center gap-4 sm:gap-6 text-left max-w-5xl mx-auto z-10 relative">
        <div className="flex-shrink-0 drop-shadow-md">
          {customImageUrl ? (
            <img src={customImageUrl} alt={holiday?.name || customAnnouncement?.title} className="w-16 h-12 object-cover rounded-md border border-white/20" />
          ) : (
            graphicElement
          )}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className={`text-sm sm:text-base font-bold tracking-wide leading-tight ${isTricolor ? 'text-blue-950' : 'text-white'}`}>
            {message}
          </span>
          <span className={`text-[10px] sm:text-xs font-semibold opacity-90 ${isTricolor ? 'text-blue-900/80' : 'text-white/80'}`}>
            {customAnnouncement ? `Announcing: ${subText}` : `Noesis Analytics wishes you and your team a wonderful holiday!`}
          </span>
        </div>
      </div>

      <button
        onClick={handleDismiss}
        className={`flex-shrink-0 rounded-full p-1.5 transition-colors cursor-pointer ml-4 z-10 relative ${isTricolor ? 'text-blue-950 hover:bg-black/5' : 'text-white/80 hover:text-white hover:bg-white/10'}`}
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

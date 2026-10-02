import { useState } from "react";

/** Each key is the file name (without extension) of an asset in public/festival-art/. */
export type FestivalKey =
  | "gandhi-jayanti" | "republic-day" | "independence-day" | "diwali" | "gujarati-new-year"
  | "holi" | "dhuleti" | "navratri" | "dussehra" | "ram-navami" | "ganesh-chaturthi"
  | "janmashtami" | "raksha-bandhan" | "bhai-dooj" | "maha-shivratri" | "uttarayan"
  | "christmas" | "good-friday" | "eid" | "gujarat-day" | "buddha-jayanti"
  | "mahavir-jayanti" | "guru-nanak-jayanti" | "new-year" | "monsoon"
  | "office-holiday" | "holiday-default";

/**
 * Maps a holiday / announcement name to an illustration key.
 * Order matters: more specific names are checked first (e.g. Navratri before Dussehra).
 */
export function getFestivalKey(name: string): FestivalKey {
  const n = (name || "").toLowerCase();
  if (n.includes("gandhi")) return "gandhi-jayanti";
  if (n.includes("republic")) return "republic-day";
  if (n.includes("independence") || n.includes("tricolor")) return "independence-day";
  if (n.includes("gujarat day")) return "gujarat-day";
  if (n.includes("gujarati") && n.includes("new year")) return "gujarati-new-year";
  if (n.includes("diwali") || n.includes("deepavali")) return "diwali";
  if (n.includes("new year")) return "new-year";
  if (n.includes("bhai")) return "bhai-dooj";
  if (n.includes("uttarayan") || n.includes("sankranti")) return "uttarayan";
  if (n.includes("shivratri")) return "maha-shivratri";
  if (n.includes("dhuleti")) return "dhuleti";
  if (/(^|[^a-z])holi([^a-z]|$)/.test(n)) return "holi";
  if (n.includes("raksha") || n.includes("rakhi")) return "raksha-bandhan";
  if (n.includes("janmashtami") || n.includes("krishna")) return "janmashtami";
  if (n.includes("ganesh")) return "ganesh-chaturthi";
  if (n.includes("navratri")) return "navratri";
  if (n.includes("dussehra") || n.includes("dasara") || n.includes("vijayadashami")) return "dussehra";
  if (n.includes("ram navami")) return "ram-navami";
  if (n.includes("christmas")) return "christmas";
  if (n.includes("good friday")) return "good-friday";
  if (/(^|[^a-z])eid([^a-z]|$)/.test(n) || n.includes("ramadan") || n.includes("bakrid") || n.includes("muharram")) return "eid";
  if (n.includes("buddha")) return "buddha-jayanti";
  if (n.includes("mahavir")) return "mahavir-jayanti";
  if (n.includes("nanak")) return "guru-nanak-jayanti";
  if (n.includes("monsoon") || /(^|[^a-z])rain([^a-z]|$)/.test(n)) return "monsoon";
  return "holiday-default";
}

export const festivalAssetUrl = (key: FestivalKey) => `/festival-art/${key}.webp`;

/** Locally hosted festival image, rendered at a fixed square size. Falls back to the generic asset if one fails to load. */
export function FestivalIllustration({ festivalKey, size = 36 }: { festivalKey: FestivalKey; size?: number }) {
  const [failed, setFailed] = useState(false);
  const key = failed ? "holiday-default" : festivalKey;
  return (
    <img
      src={festivalAssetUrl(key)}
      alt=""
      width={size}
      height={size}
      decoding="async"
      draggable={false}
      data-festival={key}
      onError={() => setFailed(true)}
      className="block select-none object-contain"
      style={{ width: size, height: size }}
    />
  );
}

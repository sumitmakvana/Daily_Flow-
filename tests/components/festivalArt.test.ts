import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getFestivalKey, festivalAssetUrl } from "@/components/festivalArt";
import { getActiveHolidaysForDate, getLocalHoliday } from "@/lib/format";

const ART_DIR = join(process.cwd(), "public", "festival-art");

const EXPECTED: Record<string, string> = {
  "Gandhi Jayanti": "gandhi-jayanti",
  "Republic Day": "republic-day",
  "Independence Day": "independence-day",
  "Gujarat Day": "gujarat-day",
  Diwali: "diwali",
  "Gujarati New Year": "gujarati-new-year",
  "New Year": "new-year",
  "Bhai Dooj": "bhai-dooj",
  Uttarayan: "uttarayan",
  "Vasi Uttarayan": "uttarayan",
  "Maha Shivratri": "maha-shivratri",
  Holi: "holi",
  Dhuleti: "dhuleti",
  "Raksha Bandhan": "raksha-bandhan",
  Janmashtami: "janmashtami",
  "Ganesh Chaturthi": "ganesh-chaturthi",
  Navratri: "navratri",
  Dussehra: "dussehra",
  "Ram Navami": "ram-navami",
  Christmas: "christmas",
  "Good Friday": "good-friday",
  "Eid al-Fitr": "eid",
  "Buddha Purnima": "buddha-jayanti",
  "Mahavir Jayanti": "mahavir-jayanti",
  "Guru Nanak Jayanti": "guru-nanak-jayanti",
  "Some Unknown Holiday": "holiday-default",
};

describe("festival asset mapping", () => {
  for (const [name, key] of Object.entries(EXPECTED)) {
    it(`${name} -> ${key}`, () => {
      const got = getFestivalKey(name);
      expect(got).toBe(key);
      expect(existsSync(join(ART_DIR, `${got}.webp`))).toBe(true);
      expect(festivalAssetUrl(got)).toBe(`/festival-art/${key}.webp`);
    });
  }

  it("every asset is a small local webp, including fallbacks", () => {
    const files = readdirSync(ART_DIR).filter((f) => f.endsWith(".webp"));
    expect(files).toContain("holiday-default.webp");
    expect(files).toContain("office-holiday.webp");
  });

  it("every supported holiday date 2025-2028 resolves to a real, non-generic asset on its day", () => {
    for (const year of [2025, 2026, 2027, 2028]) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= 31; d++) {
          const iso = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          if (new Date(iso).getUTCDate() !== d) continue;
          const h = getLocalHoliday(iso, {}, []);
          if (!h) continue;
          const today = getActiveHolidaysForDate(iso).find((x) => x.status === "today");
          expect(today?.holiday.name).toBe(h.name);
          const key = getFestivalKey(h.name);
          expect(key, `${iso} ${h.name}`).not.toBe("holiday-default");
          expect(existsSync(join(ART_DIR, `${key}.webp`)), `${key}.webp`).toBe(true);
        }
      }
    }
  });
});

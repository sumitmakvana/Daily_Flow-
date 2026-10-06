/** Installer locations for the Operon desktop app (see desktop/scripts/publish-downloads.js). */
const BASE = (import.meta.env.VITE_DESKTOP_DOWNLOAD_BASE_URL as string | undefined)?.replace(/\/+$/, "") || "/downloads";

export type DesktopPlatform = "windows" | "macos" | "linux";

export const DESKTOP_DOWNLOADS: { id: DesktopPlatform; label: string; ext: string; file: string; href: string }[] = [
  { id: "macos", label: "macOS", ext: ".dmg", file: "Operon-macOS.dmg", href: `${BASE}/Operon-macOS.dmg` },
  { id: "windows", label: "Windows", ext: ".exe", file: "Operon-Setup-Windows.exe", href: `${BASE}/Operon-Setup-Windows.exe` },
  { id: "linux", label: "Linux", ext: ".AppImage", file: "Operon-Linux.AppImage", href: `${BASE}/Operon-Linux.AppImage` },
];

export function detectDesktopPlatform(): DesktopPlatform | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return null;
}

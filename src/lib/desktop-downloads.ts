/** Installer locations for the Operon desktop app (GitHub Release desktop-v1.0.0 assets). */
const RELEASE_BASE = "https://github.com/sumitmakvana/Daily_Flow-/releases/download/desktop-v1.0.0";

export type DesktopPlatform = "windows" | "macos" | "linux";

export const DESKTOP_DOWNLOADS: { id: DesktopPlatform; label: string; ext: string; file: string; href: string }[] = [
  { id: "macos", label: "macOS", ext: ".dmg", file: "Operon-macOS.dmg", href: `${RELEASE_BASE}/Operon-macOS.dmg` },
  { id: "windows", label: "Windows", ext: ".exe", file: "Operon-Setup-Windows.exe", href: `${RELEASE_BASE}/Operon.Setup.1.0.0.exe` },
  { id: "linux", label: "Linux", ext: ".AppImage", file: "Operon-Linux.AppImage", href: `${RELEASE_BASE}/Operon-Linux.AppImage` },
];

export function detectDesktopPlatform(): DesktopPlatform | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return null;
}

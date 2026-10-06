/**
 * Copies the generated installers from desktop/dist into ../public/downloads
 * under stable file names, so the web app's Download Hub (/download-hub) can
 * link to them and `vite build` ships them in dist/client/downloads.
 * Missing installers are skipped (macOS .dmg can only be built on macOS).
 */
const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "..", "dist");
const out = path.join(__dirname, "..", "..", "public", "downloads");
fs.mkdirSync(out, { recursive: true });

const targets = [
  { find: (f) => /^Operon Setup .*\.exe$/.test(f), name: "Operon-Setup-Windows.exe" },
  { find: (f) => f === "Operon-macOS.dmg", name: "Operon-macOS.dmg" },
  { find: (f) => f === "Operon-Linux.AppImage", name: "Operon-Linux.AppImage" },
];

const files = fs.existsSync(dist) ? fs.readdirSync(dist) : [];
for (const t of targets) {
  const src = files.find(t.find);
  if (!src) {
    console.log(`skip   ${t.name} (not built)`);
    continue;
  }
  fs.copyFileSync(path.join(dist, src), path.join(out, t.name));
  console.log(`copied ${src} -> public/downloads/${t.name}`);
}

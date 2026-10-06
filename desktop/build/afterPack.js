/**
 * Embeds the Operon icon into Operon.exe. electron-builder skips this when run
 * with signAndEditExecutable=false (needed on machines without symlink
 * privilege), so we do it here with the rcedit binary from its tool cache.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function findRcedit() {
  const root = path.join(process.env.LOCALAPPDATA || "", "electron-builder", "Cache", "winCodeSign");
  if (!fs.existsSync(root)) return null;
  for (const d of fs.readdirSync(root)) {
    const p = path.join(root, d, "rcedit-x64.exe");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const rcedit = findRcedit();
  if (!rcedit) {
    // e.g. CI runners, where electron-builder embeds the icon itself (dist:icon).
    console.warn("afterPack: rcedit not found in cache, leaving icon embedding to electron-builder");
    return;
  }
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  execFileSync(rcedit, [exe, "--set-icon", path.join(context.packager.projectDir, "build", "icon.ico")]);
};

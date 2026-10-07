/**
 * Operon desktop shell.
 *
 * A thin Electron layer around the existing Operon web app. It does NOT contain
 * any app UI, API or database code: every window simply loads the production
 * Operon URL, so authentication, routing, Notebook auto-save (notebook_notes) and
 * user isolation all keep working exactly as in the browser.
 */
const { app, BrowserWindow, Tray, Menu, globalShortcut, shell, nativeImage, session, Notification } = require("electron");
const path = require("path");
const fs = require("fs");

const DEFAULT_URL = "http://operon.noesisanalytics.co.in";
const QUICK_NOTES_SHORTCUT = "Alt+N";
const PARTITION = "persist:operon"; // one persistent session shared by every window (keeps login)
const ICON_PATH = path.join(__dirname, "build", process.platform === "win32" ? "icon.ico" : "icon.png");
const TRAY_ICON_PATH = path.join(__dirname, "build", "icon.png");

/* ------------------------------ settings ------------------------------ */

const settingsFile = () => path.join(app.getPath("userData"), "desktop-settings.json");

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2));
  } catch (e) {
    console.warn("Could not save settings:", e.message);
  }
}

function getBaseUrl() {
  const raw = process.env.OPERON_URL || readSettings().url || DEFAULT_URL;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
    return u.origin;
  } catch {
    return DEFAULT_URL;
  }
}

/* ------------------------------ state ------------------------------ */

let mainWin = null;
let quickWin = null;
let tray = null;
let isQuitting = false;

const BASE_URL = () => getBaseUrl();

/* ------------------------------ helpers ------------------------------ */

function webPreferences() {
  return {
    partition: PARTITION,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: true,
  };
}

/** Optional explicit Keycloak/auth URL (env AUTH_URL or "authUrl" in desktop-settings.json). */
function getAuthOrigin() {
  try {
    return new URL(process.env.AUTH_URL || readSettings().authUrl).origin;
  } catch {
    return null;
  }
}

/**
 * True for pages that must stay inside the app window: Operon itself and its
 * Keycloak sign-in host (same hostname on any port, a sibling subdomain such as
 * auth.<domain>, or the explicit AUTH_URL). Login redirects/callbacks therefore
 * never leave Electron.
 */
function isInternalUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const base = new URL(BASE_URL());
  if (u.origin === base.origin || u.hostname === base.hostname) return true;
  if (u.origin === getAuthOrigin()) return true;
  const isIp = /^[\d.]+$/.test(base.hostname) || base.hostname.includes(":");
  const labels = base.hostname.split(".");
  if (!isIp && labels.length >= 3) {
    const parent = "." + labels.slice(1).join(".");
    if (u.hostname.endsWith(parent)) return true;
  }
  return false;
}

/** Keep navigation (incl. Keycloak login) inside Operon; send everything else to the default browser. */
function lockNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (isInternalUrl(url)) return { action: "allow" };
      if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:") shell.openExternal(url);
    } catch {
      /* ignore malformed urls */
    }
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    try {
      const u = new URL(url);
      if (isInternalUrl(url) || u.protocol === "file:") return;
      event.preventDefault();
      if (u.protocol === "http:" || u.protocol === "https:") shell.openExternal(url);
    } catch {
      event.preventDefault();
    }
  });

  // Show a friendly retry page if Operon can't be reached.
  win.webContents.on("did-fail-load", (_e, code, _desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted */ || failedUrl.startsWith("file:")) return;
    win.loadFile(path.join(__dirname, "offline.html"), { query: { target: failedUrl } });
  });
}

/* ------------------------------ windows ------------------------------ */

function showMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) {
    createMainWindow(false);
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function createMainWindow(startHidden) {
  mainWin = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 420,
    minHeight: 600,
    show: false,
    title: "Operon",
    icon: ICON_PATH,
    backgroundColor: "#0b0d12",
    autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });

  lockNavigation(mainWin);
  mainWin.loadURL(BASE_URL());

  mainWin.once("ready-to-show", () => {
    if (!startHidden) mainWin.show();
  });

  // Minimize -> tray; close -> tray (Quit lives in the tray menu).
  mainWin.on("minimize", (e) => {
    e.preventDefault();
    mainWin.hide();
  });
  mainWin.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });
  mainWin.on("closed", () => {
    mainWin = null;
  });
}

/** Small always-on-top window that opens the existing Notebook Quick Notes pad. */
function openQuickNotes() {
  if (quickWin && !quickWin.isDestroyed()) {
    if (quickWin.isMinimized()) quickWin.restore();
    quickWin.show();
    quickWin.focus();
    // Put the cursor in the existing note editor (no UI changes inside the app).
    quickWin.webContents
      .executeJavaScript("document.querySelector(\"[contenteditable='true']\")?.focus()")
      .catch(() => {});
    return;
  }

  quickWin = new BrowserWindow({
    width: 480,
    height: 660,
    minWidth: 380,
    minHeight: 440,
    title: "Operon Quick Notes",
    icon: ICON_PATH,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#0b0d12",
    webPreferences: webPreferences(),
  });
  quickWin.setAlwaysOnTop(true, "floating");

  lockNavigation(quickWin);
  // Same session as the main window => same signed-in user. A window narrower than
  // 640px makes the existing notepad render as a full-window sheet.
  quickWin.loadURL(`${BASE_URL()}/notebook?quicknotes=1`);

  quickWin.on("closed", () => {
    quickWin = null;
  });
}

/* ------------------------------ tray + startup ------------------------------ */

function launchAtStartupEnabled() {
  const s = readSettings();
  return s.launchAtStartup !== false; // on by default
}

function applyLaunchAtStartup(enabled) {
  if (!app.isPackaged) return; // don't register the dev Electron binary
  app.setLoginItemSettings({ openAtLogin: enabled, args: ["--hidden"] });
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: "Open Operon", click: showMainWindow },
    { label: `Quick Notes (${QUICK_NOTES_SHORTCUT})`, click: openQuickNotes },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: launchAtStartupEnabled(),
      click: (item) => {
        writeSettings({ launchAtStartup: item.checked });
        applyLaunchAtStartup(item.checked);
      },
    },
    { type: "separator" },
    {
      label: "Quit Operon",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Operon");
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", showMainWindow);
}

/* ------------------------------ app lifecycle ------------------------------ */

app.setAppUserModelId("in.co.noesisanalytics.operon");
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    // Only the permissions Operon actually needs (notifications, clipboard writes).
    const allowed = new Set(["notifications", "clipboard-sanitized-write", "fullscreen"]);
    session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));

    applyLaunchAtStartup(launchAtStartupEnabled());

    const startHidden = process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAtLogin;
    createMainWindow(startHidden);
    createTray();

    const ok = globalShortcut.register(QUICK_NOTES_SHORTCUT, openQuickNotes);
    if (!ok) {
      console.warn(`${QUICK_NOTES_SHORTCUT} is already in use by another application.`);
      if (Notification.isSupported()) {
        new Notification({
          title: "Operon",
          body: `${QUICK_NOTES_SHORTCUT} is used by another app. Open Quick Notes from the tray icon instead.`,
        }).show();
      }
    }
  });

  app.on("activate", showMainWindow);
  app.on("before-quit", () => {
    isQuitting = true;
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  // Stay alive in the tray when all windows are closed.
  app.on("window-all-closed", () => {});
}

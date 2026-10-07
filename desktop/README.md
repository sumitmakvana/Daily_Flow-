# Operon Desktop App

Operon Desktop is a thin **Electron** shell around the existing Operon web app. It has no app UI, API or
database code of its own: every window loads the production Operon URL, so login, routing, Notebook
auto-save and per-user data isolation behave exactly as in the browser.

Platforms: **Windows** (`.exe`), **macOS** (`.dmg`), **Linux** (`.AppImage`).

---

## 1. For users: install and use

### Install
1. Open Operon in the browser and click **Install** in the top navigation (or go to `/desktop-hub`).
2. Click **Download** next to your operating system.

| OS      | File                      | How to install |
|---------|---------------------------|----------------|
| Windows | `Operon.Setup.1.0.0.exe`  | Run it, choose an install folder, finish. Creates Desktop and Start Menu shortcuts. |
| macOS   | `Operon-macOS.dmg`        | Open it and drag **Operon** to Applications. |
| Linux   | `Operon-Linux.AppImage`   | `chmod +x Operon-Linux.AppImage`, then run it. |

The installers are **unsigned**, so you will see a warning the first time:
- Windows SmartScreen: click **More info → Run anyway**.
- macOS Gatekeeper: right-click the app → **Open** (or System Settings → Privacy & Security → **Open Anyway**).

### What the app adds over the browser
- **Alt + N (anywhere in Windows):** opens a small always-on-top **Quick Notes** window (the existing
  Notebook notepad). If it is already open it is focused instead of duplicated.
- **Tray icon:** closing or minimizing the window hides Operon to the tray instead of quitting.
  Tray menu: *Open Operon*, *Quick Notes*, *Start with Windows*, *Quit Operon*. Click the tray icon to reopen.
- **Start with Windows:** on by default, starts hidden in the tray. Toggle it in the tray menu.
- **Single instance:** launching it again just focuses the running window.
- **Links:** links to other sites open in your default browser; Operon links stay in the app.
- **Offline page:** if Operon can't be reached you get a retry page rather than a blank window.

All windows share one saved session, so you sign in once and Quick Notes uses the same user.
To fully exit, use **Quit Operon** from the tray menu.

---

## 2. For developers: how it works

```
desktop/
  main.js            Electron main process (windows, tray, shortcut, startup, navigation lock)
  offline.html       Retry page shown when Operon is unreachable
  build/
    icon.png         Operon logo (512x512) used for tray, macOS and Linux
    icon.ico         Multi-size Windows icon (16-256 px)
    afterPack.js     Embeds icon.ico into Operon.exe for local Windows builds (see below)
  package.json       Scripts and electron-builder config ("build" field)
  dist/              Build output (git-ignored)
```

- `main.js` creates the main `BrowserWindow` pointed at the Operon URL, plus the Quick Notes window
  (`/notebook?quicknotes=1`). Windows use a sandboxed, context-isolated renderer with no Node access.
- Only the permissions Operon needs are granted: notifications, clipboard write, fullscreen.
- App ID is `in.co.noesisanalytics.operon` (taskbar grouping, shortcuts, notifications).

### Operon URL
Defaults to `http://operon.noesisanalytics.co.in`. Override with:
- the `OPERON_URL` environment variable, or
- `{ "url": "https://..." }` in `%APPDATA%\Operon\desktop-settings.json`.

Sign-in (Keycloak) pages stay inside the app window when they are on the same host as Operon (any port).
If Keycloak is on a different host, set `AUTH_URL` or `"authUrl"` in the same settings file.

### Run locally
```bash
cd desktop
npm install
npm start
```
If your terminal sets `ELECTRON_RUN_AS_NODE` (VS Code and some tools do), unset it first or `npm start` will not open a window.

### Build installers
```bash
npm run dist          # Windows: dist/Operon Setup <version>.exe
npm run dist:icon     # Windows, full electron-builder icon embedding (needs admin / Developer Mode)
npm run dist:mac      # macOS:   dist/Operon-macOS.dmg        (must run on macOS)
npm run dist:linux    # Linux:   dist/Operon-Linux.AppImage   (run on Linux)
```
Platform limits:
- electron-builder **cannot build macOS from Windows or Linux**.
- On Windows, electron-builder needs symlink permission (Developer Mode or an admin shell) for Linux builds
  and for `dist:icon`. Plain `npm run dist` works without it: it skips that step, and `build/afterPack.js`
  embeds the Operon icon into `Operon.exe` using the `rcedit` tool from electron-builder's cache.

### Icons
All platforms use the Operon logo: `build/icon.ico` (Windows exe, installer, uninstaller, windows) and
`build/icon.png` (tray, macOS, Linux). To change the logo, replace `icon.png` and regenerate `icon.ico`
from it (multi-size, 16-256 px).

---

## 3. Releasing a new version

Building all three installers requires three operating systems, so use the GitHub Actions workflow
`.github/workflows/desktop-build.yml`.

1. Bump `version` in `desktop/package.json`.
2. In GitHub: **Actions → Desktop builds → Run workflow** (or push a tag like `desktop-v1.0.1`).
3. When it finishes, download the three artifacts: `operon-Windows`, `operon-macOS`, `operon-Linux`.
4. Create a GitHub Release (tag e.g. `desktop-v1.0.1`) and attach the three installer files.
5. If the version or file names changed, update the URLs in `src/lib/desktop-downloads.ts`
   (the Windows file name contains the version, e.g. `Operon.Setup.1.0.1.exe`), then deploy the web app.

The Desktop Hub page (`/desktop-hub`) links straight to the Release assets, so users always download from
GitHub, not from the Operon server.

---

## 4. Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm start` opens nothing | Unset `ELECTRON_RUN_AS_NODE`. |
| Build fails with "A required privilege is not held by the client" | Turn on Windows Developer Mode, or use an admin shell, or build on GitHub Actions. |
| Old/Electron icon still shows on shortcut or taskbar | Windows icon cache: reinstall, then sign out/in or restart Explorer. |
| Alt + N does nothing | Another app owns the shortcut. Operon shows a notification; use the tray menu instead. |
| Window won't open after closing it | It is in the tray. Click the tray icon, or choose *Open Operon*. |
| Blank/retry page | Operon URL unreachable. Check network or the URL override above, then click retry. |
| Antivirus / SmartScreen warning | Expected for unsigned installers. A code-signing certificate removes it. |

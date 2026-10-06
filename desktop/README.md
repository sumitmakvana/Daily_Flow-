# Operon Desktop (Windows)

A thin Electron shell around the **existing** Operon web app. It contains no app UI, API or database code:
every window loads the production Operon URL, so login, routing, Notebook auto-save (`notebook_notes`) and
per-user isolation are exactly the same as in the browser.

## What it adds
- **Alt + N** (system-wide): opens a small always-on-top *Quick Notes* window (`/notebook?quicknotes=1`),
  the existing Notebook notepad. If it is already open it is focused instead of duplicated.
- **Tray icon**: closing or minimizing hides Operon to the tray. Tray menu: Open Operon, Quick Notes,
  Start with Windows, Quit.
- **Start with Windows**: on by default (toggle in the tray menu). Starts hidden in the tray.
- Single instance, external links open in the default browser, and a retry page when Operon is unreachable.

All windows share one persistent session (`persist:operon`), so you sign in once and Quick Notes uses the
same signed-in user.

## Operon URL
Defaults to `http://operon.noesisanalytics.co.in`. Override with the `OPERON_URL` environment variable or by
adding `{ "url": "https://..." }` to `%APPDATA%\Operon\desktop-settings.json`.

## Develop / build
```bash
cd desktop
npm install
npm start              # run (see note below)
npm run dist           # builds dist/Operon Setup <version>.exe
npm run dist:icon      # same, but also embeds the icon in Operon.exe (needs Windows Developer Mode or an admin shell)
```
Note: if your terminal sets `ELECTRON_RUN_AS_NODE` (VS Code / some tools do), unset it before `npm start`.

The installer is unsigned, so Windows SmartScreen may show a warning until you add a code-signing certificate.

## Windows, macOS and Linux builds
```bash
npm run dist:win       # dist/Operon Setup <version>.exe   (build on Windows)
npm run dist:mac       # dist/Operon-macOS.dmg             (must be built on macOS)
npm run dist:linux     # dist/Operon-Linux.AppImage        (build on Linux)
npm run publish:downloads   # copies built installers to ../public/downloads for the web Download Hub
```
electron-builder cannot cross-build macOS, and on Windows it needs Developer Mode/admin to build Linux
(symlinks). The **Desktop builds** GitHub workflow (`.github/workflows/desktop-build.yml`) builds all three on
native runners; download the artifacts, drop them in `dist/`, run `publish:downloads`, then deploy the web app.
The Download Hub (`/download-hub`) links to `/downloads/<file>`; set `VITE_DESKTOP_DOWNLOAD_BASE_URL` to host them elsewhere.

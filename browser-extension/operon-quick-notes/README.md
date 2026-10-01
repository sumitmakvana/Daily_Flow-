# Operon Quick Notes shortcut (Chrome)

Press **Alt+N** on any normal Chrome page to open — or focus — the Operon Quick Notes window.

## Install
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Click the extension's **Details → Extension options** and set your Operon URL
   (defaults to `http://localhost:8080`).
4. If Alt+N is taken, set it at `chrome://extensions/shortcuts`.

Sign in to Operon once in that Chrome profile; the notes window uses the same login, UI and database.

## Permissions
Only `storage` (to remember the Operon URL and the open window's id).
No host permissions, no `tabs`, no content scripts, no cookies/history — the extension
cannot see or touch the pages you are browsing.

## Limits
Chrome does not deliver extension shortcuts on `chrome://` pages, the Chrome Web Store,
or the New Tab page — that is a browser restriction.

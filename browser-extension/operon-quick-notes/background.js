// Operon Quick Notes shortcut.
// Only opens/focuses an Operon window — it never reads, injects into, or
// monitors any other page (no host, tabs, cookies or history permissions).

const DEFAULT_OPERON_URL = "http://localhost:8080";
const NOTES_PATH = "/notebook?quicknotes=1";

async function getOperonBaseUrl() {
  const { operonUrl } = await chrome.storage.sync.get("operonUrl");
  return operonUrl || DEFAULT_OPERON_URL;
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-quick-notes") return;

  // Re-use the existing Quick Notes window instead of opening a duplicate.
  const { notesWindowId } = await chrome.storage.session.get("notesWindowId");
  if (notesWindowId !== undefined) {
    try {
      await chrome.windows.update(notesWindowId, { focused: true, drawAttention: true });
      return;
    } catch {
      // Window no longer exists — fall through and create a new one.
      await chrome.storage.session.remove("notesWindowId");
    }
  }

  const url = new URL(NOTES_PATH, await getOperonBaseUrl()).href;
  const win = await chrome.windows.create({ url, type: "popup", width: 520, height: 700, focused: true });
  if (win && win.id !== undefined) {
    await chrome.storage.session.set({ notesWindowId: win.id });
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { notesWindowId } = await chrome.storage.session.get("notesWindowId");
  if (windowId === notesWindowId) await chrome.storage.session.remove("notesWindowId");
});

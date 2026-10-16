/**
 * Preload for the Operon desktop shell.
 *
 * Exposes a tiny secure-storage bridge so the web app can keep its long-lived refresh token in the
 * operating system's credential store (Electron safeStorage: DPAPI / Keychain / keyring) instead of
 * localStorage. The main process only answers requests that come from the Operon origin.
 */
const { contextBridge, ipcRenderer } = require("electron");

let available = false;
try {
  available = ipcRenderer.sendSync("operon:secure-available") === true;
} catch {
  available = false;
}

contextBridge.exposeInMainWorld("operonSecureStore", {
  available,
  get: (key) => ipcRenderer.invoke("operon:secure-get", key),
  set: (key, value) => ipcRenderer.invoke("operon:secure-set", key, value),
  remove: (key) => ipcRenderer.invoke("operon:secure-remove", key),
});

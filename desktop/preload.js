/**
 * Preload for the Operon web UI. Exposes only a tiny secure-storage bridge; all crypto and file
 * access stays in the main process (Electron safeStorage), which also verifies the caller origin.
 */
const { contextBridge, ipcRenderer } = require("electron");

const available = ipcRenderer.sendSync("operon:secure:available") === true;

contextBridge.exposeInMainWorld("operonDesktop", {
  platform: process.platform,
  secureStore: {
    available,
    get: (key) => ipcRenderer.invoke("operon:secure:get", key),
    set: (key, value) => ipcRenderer.invoke("operon:secure:set", key, value),
    remove: (key) => ipcRenderer.invoke("operon:secure:remove", key),
  },
});

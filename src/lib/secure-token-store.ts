/**
 * OS-protected storage for the long-lived refresh token of the Operon apps.
 *
 *  - Electron desktop: `window.operonSecureStore`, exposed by desktop/preload.js, backed by
 *    Electron `safeStorage` (Windows DPAPI / macOS Keychain / Linux keyring).
 *  - Android: the native `OperonSecureStore` Capacitor plugin (AES-GCM key in the Android Keystore).
 *  - Plain browsers: not available (null) — the website keeps its existing behaviour.
 *
 * Callers must treat `null` as "this environment cannot persist a session securely".
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export interface SecureTokenStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}

const KEY = "kc_offline_session";

interface DesktopBridge {
  available: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<boolean>;
  remove(key: string): Promise<boolean>;
}

interface AndroidPlugin {
  get(opts: { key: string }): Promise<{ value: string | null }>;
  set(opts: { key: string; value: string }): Promise<void>;
  remove(opts: { key: string }): Promise<void>;
}

let cached: SecureTokenStore | null | undefined;

export function getSecureTokenStore(): SecureTokenStore | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (typeof window === "undefined") return cached;

  const desktop = (window as unknown as { operonSecureStore?: DesktopBridge }).operonSecureStore;
  if (desktop?.available) {
    cached = {
      get: () => desktop.get(KEY),
      set: async (v) => {
        if (!(await desktop.set(KEY, v))) throw new Error("secure store write failed");
      },
      remove: async () => void (await desktop.remove(KEY)),
    };
    return cached;
  }

  try {
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("OperonSecureStore")) {
      const plugin = registerPlugin<AndroidPlugin>("OperonSecureStore");
      cached = {
        get: async () => (await plugin.get({ key: KEY })).value ?? null,
        set: (value) => plugin.set({ key: KEY, value }),
        remove: () => plugin.remove({ key: KEY }),
      };
    }
  } catch {
    cached = null;
  }
  return cached;
}

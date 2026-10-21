/**
 * Secure storage for the Operon native apps (Android Keystore / Electron safeStorage).
 *
 * `getSecureStore()` returns null in a normal browser, and in any native shell that does not ship
 * the secure-storage bridge (e.g. an older installed build), so callers can fall back to the
 * website behaviour. Detection is synchronous and has no side effects.
 */
import { getNativePlatform, isNativeApp } from "@/lib/native-bridge";

export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

interface DesktopSecureBridge {
  available?: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

interface AndroidSecurePlugin {
  get(opts: { key: string }): Promise<{ value: string | null }>;
  set(opts: { key: string; value: string }): Promise<void>;
  remove(opts: { key: string }): Promise<void>;
}

const ANDROID_PLUGIN = "OperonSecureStorage";

function androidStore(): SecureStore {
  let plugin: Promise<AndroidSecurePlugin> | null = null;
  const load = () => {
    plugin ??= import("@capacitor/core").then(({ registerPlugin }) =>
      registerPlugin<AndroidSecurePlugin>(ANDROID_PLUGIN),
    );
    return plugin;
  };
  return {
    get: async (key) => (await (await load()).get({ key })).value ?? null,
    set: async (key, value) => void (await (await load()).set({ key, value })),
    remove: async (key) => void (await (await load()).remove({ key })),
  };
}

/**
 * Offline refresh tokens must never be exposed to a page served over plain HTTP (a network
 * attacker could inject script and read them), so secure storage requires https (or loopback).
 */
export function isSecureOrigin(loc: { protocol: string; hostname: string }): boolean {
  if (loc.protocol === "https:") return true;
  return (
    loc.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(loc.hostname)
  );
}

export function getSecureStore(
  loc: { protocol: string; hostname: string } | undefined = typeof window === "undefined"
    ? undefined
    : window.location,
): SecureStore | null {
  if (typeof window === "undefined" || !loc || !isSecureOrigin(loc)) return null;

  const desktop = (window as unknown as { operonDesktop?: { secureStore?: DesktopSecureBridge } })
    .operonDesktop?.secureStore;
  if (desktop && desktop.available === true) {
    return {
      get: (k) => desktop.get(k),
      set: (k, v) => desktop.set(k, v),
      remove: (k) => desktop.remove(k),
    };
  }

  if (isNativeApp() && getNativePlatform() === "android") {
    const cap = (
      window as unknown as { Capacitor?: { isPluginAvailable?: (n: string) => boolean } }
    ).Capacitor;
    if (cap?.isPluginAvailable?.(ANDROID_PLUGIN)) return androidStore();
  }

  return null;
}

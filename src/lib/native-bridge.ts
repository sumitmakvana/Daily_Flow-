/**
 * Native (Capacitor / Android) bridge.
 *
 * The Android app is a Capacitor shell that loads the hosted Operon web app. Native plugins are
 * imported lazily (see initNativeApp) so browsers and Electron never load them; everything here
 * is a no-op outside the native app.
 */

import type { PluginListenerHandle } from "@capacitor/core";

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

const PUSH_TOKEN_KEY = "operon_fcm_token";

function getCapacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.isNativePlatform?.() ? cap : null;
}

export function isNativeApp(): boolean {
  return getCapacitor() !== null;
}

export function getNativePlatform(): string {
  return getCapacitor()?.getPlatform?.() ?? "web";
}

export function getStoredPushToken(): string | null {
  try {
    return window.localStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storePushToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(PUSH_TOKEN_KEY, token);
    else window.localStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Resolve an in-app route (path + search) from a notification payload or deep-link URL. */
export function resolveDeepLink(data: Record<string, unknown> | undefined | null): string | null {
  if (!data) return null;
  const url = typeof data.url === "string" ? data.url : null;
  if (url) {
    try {
      const u = new URL(url, window.location.origin);
      if (u.origin === window.location.origin) return u.pathname + u.search + u.hash;
    } catch {
      /* ignore malformed */
    }
  }
  const taskId = typeof data.task_id === "string" ? data.task_id : null;
  if (taskId) return `/tasks?taskId=${encodeURIComponent(taskId)}&tab=all_tasks`;
  return "/notifications";
}

export interface NativeHandlers {
  /** Navigate inside the SPA (router history push). */
  navigate: (path: string) => void;
  /** Called with a fresh FCM token so it can be sent to the backend. */
  onPushToken: (token: string) => void;
  /** Called when the app returns to the foreground (refresh auth/session). */
  onResume: () => void;
}

/**
 * Wire Android back button, deep links, resume and FCM registration.
 * Returns a cleanup function.
 *
 * The page is loaded from a remote URL, so Capacitor does not pre-register JS plugin proxies on
 * `window.Capacitor.Plugins`. The plugin packages are therefore imported dynamically (only inside
 * the native app); importing them calls `registerPlugin`, which binds to the native side.
 */
export function initNativeApp(handlers: NativeHandlers, opts: { push: boolean }): () => void {
  const log = (...a: unknown[]) => console.log("[push-diag]", ...a);
  if (!isNativeApp()) return () => {};
  log("step1 native app; platform=", getNativePlatform());

  let cancelled = false;
  const removers: Array<() => void> = [];
  const track = (p: Promise<PluginListenerHandle>) =>
    p
      .then((h) => (cancelled ? h.remove() : void removers.push(() => void h.remove())))
      .catch((e) => console.warn("[native] could not add listener", e));

  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      track(
        App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack || window.history.length > 1) window.history.back();
          else void App.minimizeApp();
        }),
      );
      track(
        App.addListener("appUrlOpen", ({ url }) => {
          const path = resolveDeepLink({ url });
          if (path) handlers.navigate(path);
        }),
      );
      track(App.addListener("resume", () => handlers.onResume()));
      // Cold start from a tapped link.
      const launch = await App.getLaunchUrl();
      const path = launch?.url ? resolveDeepLink({ url: launch.url }) : null;
      if (path) handlers.navigate(path);
    } catch (e) {
      console.warn("[native] App plugin setup failed", e);
    }

    if (!opts.push) return;
    try {
      const { PushNotifications: Push } = await import("@capacitor/push-notifications");
      track(
        Push.addListener("registration", (t) => {
          log("step2 FCM token event received; length=", t?.value?.length ?? 0);
          if (t?.value) handlers.onPushToken(t.value);
        }),
      );
      track(
        Push.addListener("registrationError", (e) => {
          console.warn("[native] FCM registration failed (is google-services.json bundled?)", e);
        }),
      );
      track(
        Push.addListener("pushNotificationActionPerformed", (a) => {
          const path = resolveDeepLink(a?.notification?.data);
          if (path) handlers.navigate(path);
        }),
      );

      let perm = await Push.checkPermissions();
      log("step1 permission state=", perm.receive);
      if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
        perm = await Push.requestPermissions();
      }
      if (perm.receive === "granted" && !cancelled) {
        log("step1 calling PushNotifications.register()");
        await Push.register();
      } else if (perm.receive !== "granted") {
        log("step1 FAIL: notification permission not granted:", perm.receive);
      }
    } catch (e) {
      console.warn("[native] push setup failed", e);
    }
  })();

  return () => {
    cancelled = true;
    removers.forEach((r) => r());
  };
}

/** Drop delivered notifications on sign-out so a shared device doesn't keep showing them. */
export async function teardownNativePush() {
  if (!isNativeApp()) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.removeAllDeliveredNotifications();
  } catch {
    /* ignore */
  }
}

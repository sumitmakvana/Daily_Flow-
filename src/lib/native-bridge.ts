/**
 * Native (Capacitor / Android) bridge.
 *
 * The Android app is a Capacitor shell that loads the hosted Operon web app, so
 * Capacitor injects `window.Capacitor` (and its native plugin proxies) into the
 * page. This module talks to that global directly — no @capacitor/* npm
 * dependency in the web bundle — and is a no-op in browsers and Electron.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, any>;
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

function plugin(name: string): any | null {
  return getCapacitor()?.Plugins?.[name] ?? null;
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
 */
export function initNativeApp(handlers: NativeHandlers, opts: { push: boolean }): () => void {
  if (!isNativeApp()) return () => {};
  const removers: Array<() => void> = [];
  const track = (p: Promise<{ remove: () => void }> | { remove: () => void } | undefined) => {
    Promise.resolve(p)
      .then((h) => h && removers.push(() => h.remove()))
      .catch(() => {});
  };

  const App = plugin("App");
  if (App) {
    track(
      App.addListener("backButton", ({ canGoBack }: { canGoBack: boolean }) => {
        if (canGoBack || window.history.length > 1) window.history.back();
        else App.minimizeApp?.();
      }),
    );
    track(
      App.addListener("appUrlOpen", ({ url }: { url: string }) => {
        const path = resolveDeepLink({ url });
        if (path) handlers.navigate(path);
      }),
    );
    track(App.addListener("resume", () => handlers.onResume()));
    // Cold start from a tapped link.
    App.getLaunchUrl?.()
      .then((r: { url?: string } | undefined) => {
        const path = r?.url ? resolveDeepLink({ url: r.url }) : null;
        if (path) handlers.navigate(path);
      })
      .catch(() => {});
  }

  const Push = opts.push ? plugin("PushNotifications") : null;
  if (Push) {
    track(
      Push.addListener("registration", (t: { value: string }) => {
        if (t?.value) handlers.onPushToken(t.value);
      }),
    );
    track(
      Push.addListener("registrationError", (e: unknown) => {
        console.warn("[native] FCM registration failed (is google-services.json bundled?)", e);
      }),
    );
    track(
      Push.addListener(
        "pushNotificationActionPerformed",
        (a: { notification?: { data?: Record<string, unknown> } }) => {
          const path = resolveDeepLink(a?.notification?.data);
          if (path) handlers.navigate(path);
        },
      ),
    );
    (async () => {
      try {
        let perm = await Push.checkPermissions();
        if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
          perm = await Push.requestPermissions();
        }
        if (perm.receive === "granted") await Push.register();
      } catch (e) {
        console.warn("[native] push setup failed", e);
      }
    })();
  }

  return () => removers.forEach((r) => r());
}

/** Drop native notifications/registration on sign-out so a shared device stops receiving them. */
export async function teardownNativePush() {
  try {
    await plugin("PushNotifications")?.removeAllDeliveredNotifications?.();
  } catch {
    /* ignore */
  }
}

import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  initNativeApp,
  isNativeApp,
  storePushToken,
  getStoredPushToken,
} from "@/lib/native-bridge";
import { refreshSessionNow } from "@/integrations/backend/auth";
import { registerDeviceTokenFn } from "@/services/device-tokens.functions";

/** Android (Capacitor) lifecycle: back button, deep links, FCM registration, token refresh on resume. */
export function useNativeApp(userId?: string | null) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!userId || !isNativeApp()) return;
    return initNativeApp(
      {
        navigate: (path) => routerRef.current.history.push(path),
        onPushToken: (token) => {
          storePushToken(token);
          console.log(
            "[push-diag] step3 sending token to backend; hasAuthToken=",
            !!window.localStorage.getItem("kc_token"),
          );
          registerDeviceTokenFn({ data: { token, platform: "android" } })
            .then((r) => console.log("[push-diag] step3 backend responded", r))
            .catch((e) =>
              console.warn("[push-diag] step3 FAIL backend register error:", e?.message ?? e),
            );
        },
        onResume: () => {
          void refreshSessionNow();
        },
      },
      { push: true },
    );
  }, [userId]);
}

export { getStoredPushToken };

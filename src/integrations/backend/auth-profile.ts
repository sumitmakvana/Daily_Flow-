/**
 * Chooses which Keycloak client the current runtime authenticates with.
 *
 * - Website (and any shell without secure storage, or with the flag off): `execution-os`,
 *   exactly as before. In that case secure storage is never even probed.
 * - Android / Electron with secure storage AND the feature flag on: `operon-app`, with offline
 *   access so the session survives the 12h SSO limit.
 */
import { getSecureStore, type SecureStore } from "@/lib/secure-storage";

export const WEB_CLIENT_ID = "execution-os";
export const NATIVE_CLIENT_ID = "operon-app";
export const WEB_SCOPE = "openid profile email";
export const NATIVE_SCOPE = "openid profile email offline_access";

export interface AuthProfile {
  clientId: string;
  scope: string;
  /** Non-null only for the native (operon-app) profile. */
  store: SecureStore | null;
}

/** Build-time flag, OFF unless VITE_NATIVE_PERSISTENT_LOGIN === "true". */
export function isPersistentLoginEnabled(): boolean {
  return import.meta.env.VITE_NATIVE_PERSISTENT_LOGIN === "true";
}

export function resolveAuthProfile(): AuthProfile {
  if (isPersistentLoginEnabled()) {
    const store = getSecureStore();
    if (store) return { clientId: NATIVE_CLIENT_ID, scope: NATIVE_SCOPE, store };
  }
  return { clientId: WEB_CLIENT_ID, scope: WEB_SCOPE, store: null };
}

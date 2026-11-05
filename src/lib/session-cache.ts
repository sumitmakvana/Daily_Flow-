/**
 * One place that decides when per-user, session-level caches (roles, my profile, people list) are dropped.
 *
 * They are dropped when the identity really changes: sign-out or a different user. They are NOT dropped
 * on `TOKEN_REFRESHED` (same user, same roles; the Keycloak wrapper fires it every few minutes) or on the
 * "signed in" the wrapper replays to every new subscriber. Role / profile edits call the cache's own
 * `invalidate*()` instead.
 */
import { auth } from "@/integrations/backend/auth";

const resetters = new Set<() => void>();
let hooked = false;
let knownUserId: string | null | undefined;

/** Run every registered reset (sign-out, user switch). */
export function resetSessionCaches() {
  resetters.forEach((fn) => fn());
}

/** Register a cache to be dropped on sign-out / user switch. Returns an unregister function. */
export function registerSessionReset(fn: () => void): () => void {
  resetters.add(fn);
  hookAuth();
  return () => resetters.delete(fn);
}

function hookAuth() {
  if (hooked || typeof window === "undefined") return;
  hooked = true;
  try {
    auth.onAuthStateChange((event, s) => {
      const id = s?.user?.id ?? null;
      if (event === "SIGNED_OUT" || id === null || (knownUserId !== undefined && knownUserId !== id)) {
        resetSessionCaches();
      }
      knownUserId = id;
    });
  } catch {
    /* no auth available (e.g. a test); TTLs still bound staleness */
  }
}

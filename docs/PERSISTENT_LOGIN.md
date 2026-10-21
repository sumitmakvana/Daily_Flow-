# Persistent login for Android + Desktop (`operon-app`)

Status: implemented behind `VITE_NATIVE_PERSISTENT_LOGIN` (OFF by default). Nothing here is
deployed or applied to Keycloak.

## How it works
- Website, and any shell without secure storage or with the flag off: `execution-os`, unchanged.
  `resolveAuthProfile()` does not even probe secure storage when the flag is off.
- Android/Electron with the flag on and secure storage available: client `operon-app`, scope
  `openid profile email offline_access`. The offline refresh token lives only in the Android
  Keystore (`OperonSecureStoragePlugin`) or Electron `safeStorage` (`desktop/preload.js` + IPC in
  `desktop/main.js`, origin-checked). The 12h access token stays in `localStorage` (`kc_token`) so the
  PostgREST fetch interceptor is unchanged.
- Refresh: on start (2 retries with backoff), every 60s, on resume/visibility/online, via the
  `refresh_token` grant, serialized across windows with `navigator.locks`. Only `invalid_grant` clears
  the session; network errors, 5xx and other 4xx keep the stored token (a still-valid cached access
  token keeps the user signed in; a later success emits SIGNED_IN).
- Logout: stores a `pending_revoke` token, wipes the local session, then POSTs `/logout` and `/revoke`.
  If the revoke fails (offline) it is retried on the next start / `online` event.
- HTTPS gate: secure storage is offered only on https (or loopback) pages, both in the renderer
  (`secure-storage.ts`) and in Electron main (`desktop/secure-gate.js`). The Electron default URL is still
  `http://`, so desktop stays on `execution-os` until that URL is switched to https (needs approval).
- Android: the plugin only answers while the WebView is on the configured server origin, and deletes
  stored data only on permanent decrypt errors (transient Keystore errors are rejected and retried).
- `role=authenticated` comes from the `role-hardcoded` mapper, which must exist on `operon-app`.
  App roles still come from `public.user_roles`.

## Keycloak steps (STAGING FIRST; not yet applied)
1. Import `infra/keycloak/operon-app.client.json` (Clients → Import client). It is not part of the
   realm import, so the compose stack is unaffected.
2. Confirm users have the `offline_access` realm role (default roles) and that the client's
   optional scope list includes `offline_access`.
3. Realm settings → Sessions: set **Offline Session Idle** to 30 days (2592000 s) on staging.
   Leave all SSO settings (12h) alone. Check the Offline Session Max setting stays disabled.
4. `operon-app.client.json` lists https origins only and no explicit client scopes (realm defaults apply,
   mirroring `execution-os`); confirm `offline_access` is an optional scope on the new client in staging.

## Build / deploy order
1. Create `operon-app` in Keycloak (dormant).
2. Deploy the web bundle with the flag unset (identical behaviour for everyone).
3. Build and ship the Android APK and Electron installer (new native code required).
4. Build the web bundle with `VITE_NATIVE_PERSISTENT_LOGIN=true` only after staging passes.
   Old app builds lack secure storage and keep using `execution-os`.

## Tests
- Automated: `npx vitest run tests/lib/auth-profile.test.ts` (website uses `execution-os`, never
  reads/writes secure storage; native uses `operon-app`; logout revokes).
- Website regression (before and after on staging): log in, decode the token, compare
  `azp=execution-os`, `role=authenticated`, roles, `exp-iat=43200`; confirm no offline session was
  created; check admin/manager/member gating and website logout.
- Native: log in, restart, reach >12h (or shorten staging timeouts), resume refresh, logout then
  confirm the refresh grant fails, offline session gone in Keycloak, secure store empty, no tokens
  in logcat/console. Old build + new bundle falls back to `execution-os`.
- Users signed in before the update must log in once.

## Rollback
1. Rebuild/redeploy the web bundle with the flag unset (apps revert to `execution-os`).
2. Disable the `operon-app` client; revoke its offline sessions (Sessions → Offline).
3. `execution-os` is never edited, so nothing to restore. Code rollback: revert the PR.

## Separate change: rotate the committed `service_role` JWT secret (NOT done)
`infra/docker-compose.yml` `PGRST_JWT_SECRET` contains an HS256 `oct` key (`service_role_key`) whose
value is the public Supabase demo secret. If PostgREST is reachable, anyone can mint a
`service_role` token. It is in git history, so rotation is required.
1. Inventory consumers of service-role access (`SUPABASE_SERVICE_ROLE_KEY`, server code) and
   whether PostgREST is publicly reachable (Caddyfile).
2. Generate a new 64-byte random secret; mint a new service-role token from it.
3. Move the whole JWKS/secret to an untracked `.env`; in compose use `${PGRST_JWT_SECRET}`.
4. In a maintenance window: update consumers' token, restart PostgREST, verify Keycloak tokens
   still work and the old demo-secret token returns 401.
5. Rotate in git history only if the repo is shared; assume the old value is compromised anyway.
Also review: `KEYAKLOAK_ADMIN` typo, `admin` password defaults, seeded realm user passwords.

# Persistent login for the Android and Desktop apps

The **website is unchanged**: it uses the Keycloak client `execution-os`, whose refresh token is
bound to the SSO session, so the existing session limit (8h) still logs users out.

The **apps** (Android Capacitor, Electron desktop) sign in against a separate client,
`operon-app`, requesting the `offline_access` scope. Keycloak then issues an *offline* refresh
token that lives in an **offline session** — governed by the offline-session settings, not the SSO
session — so the app stays signed in until the user logs out (or an admin revokes the session, or
the offline idle limit is hit).

## Where the token lives
| Platform | Storage |
|---|---|
| Android | AES-256-GCM key in the Android Keystore (`OperonSecureStorePlugin`), ciphertext in app-private prefs |
| Desktop | Electron `safeStorage` (Windows DPAPI / macOS Keychain / Linux keyring) via `desktop/preload.js` |
| Website | n/a — unchanged (`localStorage`, SSO-bound) |

If an environment has no secure storage (e.g. Linux without a keyring) the app silently uses the
website behaviour: a normal, non-persistent session. The refresh token is never written to
`localStorage` in app mode, and tokens are never logged.

## Required Keycloak configuration (realm `lovable`) — NOT applied by code
The realm import file only applies to a fresh realm (`IGNORE_EXISTING`), so on the live server do this
in the admin console:

1. **Create client `operon-app`** (use `infra/keycloak-realm.json` as the reference):
   - Client authentication **off** (public), **Direct access grants ON**, Standard flow OFF.
   - Client scopes → add **`offline_access`** as an *Optional* scope.
   - **Copy every protocol mapper of `execution-os`** (notably the hard-coded claim `role = authenticated`);
     the backend/database rely on the same claims for both clients.
2. **Users need the `offline_access` realm role** (included in `default-roles-lovable` by default).
3. **Realm settings → Sessions → Offline Session Idle** — set it to the longest time a device may stay
   unused before login is required (the repo's realm file has 12 h, which would sign devices out
   overnight; 30–60 days is typical). Leave **Offline Session Max** disabled for "until logout".
   These settings affect only offline sessions; SSO Session Idle/Max (the website limit) stay as they are.
4. Optional: **Offline sessions per user/client limit** to cap devices; revoke sessions per device under
   *Users → Sessions*.

Until step 1–2 are done the apps keep working: login falls back to `execution-os` (a console warning is
logged) and the session behaves like the website's.

## Behaviour
- Launch / reboot / PC restart: the stored token is exchanged for new tokens; if the network is not up yet
  it retries and **never signs out for a network error** — only for `invalid_grant`/401 (expired or revoked).
- Access tokens are refreshed when < 2 min remain: every 60 s, on app resume/foreground, and when the
  network comes back. One refresh at a time (refresh tokens may rotate).
- Explicit logout: offline token revoked server-side, secure storage and `localStorage` wiped, push token removed.
- Desktop already starts at login and lives in the tray, so it also stays signed in across PC restarts.

## Security notes
- Dedicated client = the website's client, scopes and lifetimes are untouched; revoke/limit app sessions independently.
- Offline tokens are long-lived bearer credentials: they are only in OS-protected storage and are revoked on logout.
- Backend JWT verification is signature-based and accepts both clients' tokens.

## Verify on real devices (not covered by automated tests)
1. Log in, kill/reopen the app → still signed in. 2. Reboot phone / PC → still signed in (check with network
off then on). 3. Wait past the access-token lifetime → silent refresh. 4. Revoke the session in Keycloak →
next refresh sends the user to `/login`. 5. Log out → relaunch shows login; session gone in Keycloak.
6. Website still logs out after its normal limit.

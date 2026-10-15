# Operon Android app (Capacitor)

A thin native shell, like `desktop/` (Electron): it loads the hosted Operon web app
(`server.url` in `capacitor.config.json`), so the UI, APIs, Keycloak login and database are
exactly the web app's. Native-only behaviour lives in `src/lib/native-bridge.ts` and
`src/hooks/use-native-app.ts` and is a no-op in browsers/Electron.

## Build a debug APK (Windows)

Prereqs: JDK 21, Android SDK (platform 35, build-tools 35), `ANDROID_HOME`, `JAVA_HOME`.

```powershell
cd mobile
npm install
npx cap sync android
cd android
.\gradlew.bat assembleDebug
# -> mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

`android/local.properties` (git-ignored) must contain `sdk.dir=C:/path/to/sdk` (forward slashes).

To point at another server: edit `server.url` (and `allowNavigation`, the manifest deep-link host)
then `npx cap sync android`.

## Push notifications (FCM) — needs your credentials

1. Firebase console → add Android app with package `in.co.noesisanalytics.operon`.
2. Download `google-services.json` → `mobile/android/app/google-services.json` (git-ignored). Rebuild.
3. Firebase → Project settings → Service accounts → generate key. On the **backend** set
   `FCM_SERVICE_ACCOUNT_JSON` (the JSON) or `FCM_SERVICE_ACCOUNT_FILE` (path).
4. Apply `supabase/migrations/20261015000000_create_device_tokens.sql` (the server also creates the
   table lazily with `IF NOT EXISTS`, like other Operon tables).

Without these, the app works normally and push is simply disabled.

Flow: app registers FCM token → `registerDeviceTokenFn` stores it in `device_tokens` → the existing
`notifications` INSERT listener (`notification-listener.server.ts`) also calls `sendPushToUser` →
tapping a push opens `/tasks?taskId=…` (or `/notifications`).

## Release build
Create a keystore (never commit it), configure `signingConfigs` in `android/app/build.gradle`,
run `gradlew.bat assembleRelease` (or `bundleRelease` for Play).

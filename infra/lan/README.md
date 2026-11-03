# DailyFlow LAN stack

Run DailyFlow on one Windows PC and open it from other laptops/phones on the same Wi-Fi at
`http://<PC-LAN-IP>:17050`.

Fully standalone: own Compose project (`dailyflow-lan`), own volume (`dailyflow-lan_pgdata_lan`),
own ports. It does **not** touch `infra/docker-compose.yml` (prod), `infra/docker-compose.local.yml`
(local, ports 7050-7052) or their data, and can run side by side with the local stack.

```
 other device ── http://LAN_IP:17050 ──► app (Node, serves UI + /socket.io realtime)
              ── http://LAN_IP:17051 ──► caddy ──► postgrest ──► postgres
              ── http://LAN_IP:17052 ──► caddy ──► keycloak ───► postgres
```

| Service    | Host exposure                     | Notes |
|------------|-----------------------------------|-------|
| app        | `0.0.0.0:17050`                   | UI, server functions, Socket.IO (same origin, no CORS) |
| caddy      | `0.0.0.0:17051` (API), `:17052` (auth) | plain HTTP reverse proxy |
| postgrest  | none (compose network only)       | CORS limited to the LAN app origin |
| keycloak   | none (via caddy `:17052`)         | client redirect/web origins set to the LAN IP |
| postgres   | **none** — never published        | only reachable by other containers |

## Prerequisites
- Docker Desktop running; PowerShell 5.1+.
- `infra\dump-postgres-202610271113operon.dump` (the seed dump the local stack uses — it carries the
  Keycloak signing keys PostgREST trusts) and `infra\.env.local-test`.
- PC and other devices on the same Wi-Fi/subnet (guest/"client isolation" networks block this).

## Start (exact steps)
```powershell
cd "C:\Users\sumit\Downloads\Daily Flow Postgres\infra\lan"

# first time, in an *Administrator* PowerShell: also creates the firewall rule
.\start.ps1 -OpenFirewall

# afterwards (normal PowerShell)
.\start.ps1
```
`start.ps1` will: detect the Wi-Fi IPv4 → create `.env.lan` on first run (secrets reused from
`infra\.env.local-test`, JWKS from `docker-compose.local.yml`; nothing is hardcoded in the repo) →
validate the compose config → start Postgres → restore the seed dump once into the new volume →
build/start everything → add the LAN origins to the Keycloak client (direct SQL, no admin password needed) → print the URL.

The first run builds the app image (several minutes). Open the printed URL, e.g.
`http://192.168.1.20:17050`, on any device and sign in with your existing DailyFlow users.
On the host PC use the IP URL too, not `localhost` (the app hard-codes `localhost` → local stack's Keycloak).

## Configuration (`.env.lan`, git-ignored)
Copy of `.env.lan.example`. Key settings:
- `LAN_IP` — empty = auto-detect; set it to pin the address (e.g. a DHCP reservation). If the IP
  changes, just run `.\start.ps1` again: the image is rebuilt (the API URL is baked into the bundle)
  and Keycloak/CORS are re-pointed.
- `APP_PORT / API_PORT / AUTH_PORT` — `17050 / 17051 / 17052`. The browser finds Keycloak by
  replacing `7050` with `7052` in the app's host, so `APP_PORT` must contain `7050` and `AUTH_PORT`
  must be the same number with `7052` (`start.ps1` checks this).
- Optional SMTP / Microsoft / FCM values for email and push (blank = disabled; in-app notifications
  and realtime work regardless).

## Windows Firewall
`.\start.ps1 -OpenFirewall` (Administrator) does this; manually:
```powershell
New-NetFirewallRule -DisplayName "DailyFlow LAN" -Direction Inbound -Action Allow -Protocol TCP `
  -LocalPort 17050,17051,17052 -Profile Private
```
Wi-Fi must be a **Private** network (Settings → Network & internet → Wi-Fi → network properties →
Private). Do not open 5432. Remove later: `.\stop.ps1 -RemoveFirewall` (Administrator).

## Status / stop
```powershell
.\status.ps1                 # containers, URL checks via the LAN IP, listeners, postgres not exposed, firewall
.\stop.ps1                   # stop + remove containers, KEEP data
.\stop.ps1 -Purge            # also delete the dailyflow-lan database volume (asks for YES)
```

## Verify from another device
1. Browser: `http://<LAN-IP>:17050` → login page → sign in → tasks load.
2. `http://<LAN-IP>:17052/realms/lovable/.well-known/openid-configuration` returns JSON.
3. Open the app on two devices; change a task on one — the other updates (Socket.IO).

## Limitations / troubleshooting
- Plain HTTP on a LAN IP is not a "secure context": password login works (it uses the direct-grant
  flow), but the redirect-based Keycloak login/registration (PKCE needs `crypto.subtle`) and browser
  features requiring HTTPS (e.g. camera/geolocation, web push) won't on other devices.
  Use HTTPS (e.g. a trusted local cert in front) if you need those.
- Keycloak admin console (`:17052/admin`) is reachable on the LAN with the admin credentials from `.env.lan`; change them for anything beyond a trusted network.
- Others can't connect: run `.\status.ps1`; check the firewall rule, Private profile, same subnet, and that `LAN_IP` is the Wi-Fi address (`ipconfig`).
- Port in use: change the three ports in `.env.lan` (keep the 7050/7052 pattern).
- Login fails after an IP change: re-run `.\start.ps1` (it re-applies the Keycloak origins).
- Reset everything: `.\stop.ps1 -Purge` then `.\start.ps1`.

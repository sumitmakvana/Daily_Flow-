# Self-Hosted Stack & Cutover Runbook (Phase B)

Everything in this directory runs on **your VM**, not in the Lovable sandbox.

## Stack

```
                 caddy:2  (auto TLS)
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
 api.example.com  auth.example   files.example
   postgrest:v12   gotrue:v2      minio:latest
        │            │             │
        └──── postgres:16 ─────────┘
                  │
              pgbackrest  (daily full + 15-min WAL)
```

PostgREST + GoTrue are the open-source pieces underneath Supabase. Keeping
them is what lets 102 RLS policies, 61 functions, and 150 `.from()` call
sites work unchanged after cutover.

## Prerequisites on the VM

- Docker Engine 24+ and Docker Compose v2
- DNS A records: `api.example.com`, `auth.example.com`, `files.example.com`
  pointing at the VM (or one host + path-routing in `Caddyfile`)
- Google OAuth client with the new redirect URI
  `https://auth.example.com/callback` added
- Ports 80/443 open inbound; Postgres bound to 127.0.0.1 only

## One-time setup

```bash
cp .env.example .env             # then edit secrets
docker compose pull
docker compose up -d postgres
docker compose exec -T postgres psql -U postgres -d postgres -f /sql/00-auth-stub.sql
```

## Cutover sequence

```bash
./scripts/export-from-supabase.sh    # produces sql/01-schema.sql, 02-data.sql, 03-policies.sql
./scripts/cutover.sh --dry-run       # validate
./scripts/cutover.sh                 # ~15 min downtime window
./scripts/parity-check.sh            # row counts + md5
```

After the parity check passes, set `BACKEND_MODE=self` in the app's
deployment env. The Supabase project stays as read-only fallback for 7 days.

## Rollback

```bash
./scripts/rollback.sh    # flips BACKEND_MODE back to supabase
```

Data on Supabase is the source of truth for the rollback window.

## What you change in Google Cloud Console

Update OAuth 2.0 Client → Authorized redirect URIs:
- remove `https://<project>.supabase.co/auth/v1/callback`
- add `https://auth.example.com/callback`

This is a ~15 min window where Google sign-in is unavailable.

## pg_cron re-registration

`scripts/cutover.sh` prints the SQL to re-create the 8 cron hooks against
the new public URL. Apply it after the app deployment is on `self` mode.

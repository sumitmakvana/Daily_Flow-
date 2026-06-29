#!/usr/bin/env bash
# Cutover runbook. Default is --dry-run: prints what it would do.
# Run without --dry-run when you are inside the 15-min maintenance window.
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=1
for a in "$@"; do [ "$a" = "--execute" ] && DRY=0; done

say() { printf '\n[cutover] %s\n' "$*"; }
run() { if [ "$DRY" -eq 1 ]; then echo "  DRY:  $*"; else echo "  RUN:  $*"; eval "$@"; fi; }

source .env

say "0. Sanity"
test -f sql/01-schema.sql || { echo "run export-from-supabase.sh first"; exit 1; }

say "1. Bring up postgres only"
run "docker compose up -d postgres"
run "docker compose exec -T postgres pg_isready -U $POSTGRES_USER -d $POSTGRES_DB"

say "2. Apply auth stub"
run "docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -f /sql/00-auth-stub.sql"

say "3. Restore schema -> data -> policies"
run "docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -f /sql/01-schema.sql"
run "docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -f /sql/02-data.sql"
run "docker compose exec -T postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -f /sql/03-policies.sql"

say "4. Boot GoTrue (creates its own auth.users) + PostgREST + MinIO"
run "docker compose up -d gotrue postgrest minio minio-init caddy"

say "5. Mirror storage objects from Supabase to MinIO"
run "mc alias set src $SUPABASE_STORAGE_URL '' $SUPABASE_SERVICE_ROLE_KEY"
run "mc alias set dst https://$FILES_DOMAIN $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD"
run "mc mirror --overwrite src/work-item-files dst/$MINIO_BUCKET"

say "6. Smoke tests"
run "curl -fsS https://$API_DOMAIN/work_item_types?limit=1 -H 'Accept: application/json'"
run "curl -fsS https://$AUTH_DOMAIN/health"

say "7. NEXT — set BACKEND_MODE=self in app deployment and redeploy."
say "   Then run scripts/parity-check.sh."
[ "$DRY" -eq 1 ] && echo "(dry-run only — pass --execute to actually run)"

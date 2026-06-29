#!/usr/bin/env bash
# Post-cutover parity check. Compares row counts and md5 hashes of key
# tables between the OLD source (Supabase) and the NEW self-hosted DB.
set -euo pipefail
cd "$(dirname "$0")/.."
source .env

: "${SUPABASE_DB_URL:?}"

TABLES=(tasks comments attachments notifications task_history
        approval_requests automation_runs profiles user_roles)

dst() { docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"; }
src() { psql "$SUPABASE_DB_URL" -At -c "$1"; }

printf '%-26s %12s %12s   %s\n' table src_rows dst_rows match
for t in "${TABLES[@]}"; do
  s=$(src "select count(*) from public.$t")
  d=$(dst "select count(*) from public.$t")
  m=$( [ "$s" = "$d" ] && echo OK || echo MISMATCH )
  printf '%-26s %12s %12s   %s\n' "$t" "$s" "$d" "$m"
done

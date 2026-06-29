#!/usr/bin/env bash
# Produces sql/01-schema.sql, 02-data.sql, 03-policies.sql from the live
# Supabase project. Requires SUPABASE_DB_URL in env (postgres://... with
# the project DB password).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SUPABASE_DB_URL:?set SUPABASE_DB_URL=postgres://...}"
mkdir -p sql

echo "[1/3] schema (no policies, no data)..."
pg_dump --schema-only --no-owner --no-acl \
        --schema=public \
        --exclude-table-data='*' \
        "$SUPABASE_DB_URL" \
  | grep -vE '^(CREATE POLICY|ALTER TABLE .* ENABLE ROW LEVEL SECURITY)' \
  > sql/01-schema.sql

echo "[2/3] data..."
pg_dump --data-only --no-owner --no-acl \
        --schema=public --disable-triggers \
        "$SUPABASE_DB_URL" \
  > sql/02-data.sql

echo "[3/3] policies + RLS enable..."
pg_dump --schema-only --no-owner --no-acl \
        --schema=public \
        "$SUPABASE_DB_URL" \
  | grep -E '^(CREATE POLICY|ALTER TABLE .* ENABLE ROW LEVEL SECURITY)' \
  > sql/03-policies.sql

wc -l sql/0{1,2,3}-*.sql
echo "OK — review the three files before running cutover.sh"

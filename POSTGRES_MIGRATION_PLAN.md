# PHASE MT-1 — PostgreSQL Self-Hosted Migration Plan (Database Only)

**Date:** 2026-06-19  
**Scope:** Move the **database tier only** off Supabase onto a self-hosted PostgreSQL 16 container co-located on the application VM.  
**Out of scope (deferred):** Supabase Auth (GoTrue), Storage, Realtime, Edge Functions. These remain on Supabase until a later phase.  
**Constraint:** *No code is modified by this document. Planning only.*

> **Architectural note.** Because Auth/Storage/Realtime stay on Supabase, the self-hosted Postgres must (a) preserve `auth.uid()` semantics for the 102 RLS policies, and (b) accept the same Supabase-issued JWTs. The plan below uses **PostgREST + a stub `auth` schema seeded with the same `JWT_SECRET`** so the app keeps working unchanged.

---

## 1. TARGET ARCHITECTURE

### 1.1 Component layout (single VM, Docker Compose)

```text
┌────────────────────────────────────────────────────────────────┐
│  VM (Linux, 8 vCPU / 16 GB RAM / NVMe)                         │
│                                                                │
│  ┌─────────────┐   :443    ┌──────────────────────────────┐    │
│  │  caddy/nginx│──────────►│  app  (TanStack Start)       │    │
│  └─────────────┘           │  container: app:prod         │    │
│         ▲                  └──────┬───────────────────────┘    │
│         │                         │ :3001 PostgREST            │
│         │ Supabase JWT            ▼                            │
│         │ (Auth/Storage/Realtime  ┌──────────────────────────┐ │
│         │  still on supabase.co)  │ postgrest:12             │ │
│         │                         │  JWT_SECRET = same as SB │ │
│         │                         └──────┬───────────────────┘ │
│         │                                │ libpq :5432         │
│         │                                ▼                     │
│         │             ┌──────────────────────────────────────┐ │
│         │             │ pgbouncer:1.22 (transaction mode)    │ │
│         │             │  max_client_conn=500 default_pool=20 │ │
│         │             └──────┬───────────────────────────────┘ │
│         │                    │ :6432                           │
│         │                    ▼                                 │
│         │       ┌────────────────────────────────────────┐     │
│         │       │ postgres:16  (pg_cron, pgcrypto, uuid) │     │
│         │       │  volume: /var/lib/postgresql/data      │     │
│         │       │  shared_buffers=4GB work_mem=32MB      │     │
│         │       └──────┬─────────────────────────────────┘     │
│         │              │ logical replication slot              │
│         │              ▼                                       │
│         │   ┌──────────────────────┐   ┌───────────────────┐   │
│         │   │ pgbackrest (sidecar) │──►│ volume: /backups  │──►off-VM (S3/MinIO)
│         │   │ full/diff/incr + WAL │   └───────────────────┘   │
│         │   └──────────────────────┘                           │
│         │   ┌──────────────────────┐                           │
│         │   │ pgadmin (optional)   │ :5050  internal-only      │
│         │   └──────────────────────┘                           │
└────────────────────────────────────────────────────────────────┘
                        ▲
                        │ (only Auth/Storage/Realtime traffic)
                        ▼
              supabase.co (Auth, Storage, Realtime)
```

### 1.2 Docker Compose services (specification, not code)

| Service | Image | Purpose | Volumes | Ports (host) |
|---|---|---|---|---|
| `postgres` | `postgres:16-bookworm` + `pg_cron` ext | Primary DB | `pgdata:/var/lib/postgresql/data` | none (internal) |
| `pgbouncer` | `edoburu/pgbouncer:1.22` | Connection pool, transaction mode | — | none |
| `postgrest` | `postgrest/postgrest:v12` | REST API the app already talks to | — | none |
| `pgbackrest` | `pgbackrest/pgbackrest:2.51` | Continuous WAL archiving + nightly full | `backups:/var/lib/pgbackrest`, `pgdata:ro` | none |
| `pgadmin` (opt) | `dpage/pgadmin4:8` | Admin UI, **bind to 127.0.0.1:5050 only** | `pgadmin:/var/lib/pgadmin` | 127.0.0.1:5050 |
| `app` | existing | App | — | 8080 (behind caddy) |

All services share one Docker network `dbnet`. Only `caddy` is exposed publicly.

### 1.3 Postgres extensions / roles required at init

- Extensions: `pgcrypto`, `uuid-ossp`, `pg_cron`, `pg_stat_statements`
- Roles (mirroring Supabase): `anon`, `authenticated`, `service_role`, `authenticator` (login role used by PostgREST), `postgres` (superuser)
- Stub `auth` schema containing: `auth.uid()`, `auth.role()`, `auth.jwt()` — each reading `current_setting('request.jwt.claim.sub', true)` etc., so the 102 RLS policies keep working byte-for-byte.

---

## 2. DATABASE EXPORT PLAN

Run from a workstation with `psql` + `pg_dump` ≥ 16 that can reach Supabase via the pooler bypass URL.

### 2.1 Pre-export inventory snapshot

Persist a JSON manifest (`export_manifest.json`) of expected counts so import can be validated. Sources:

```sql
-- counts
SELECT 'tables'    , count(*) FROM pg_tables   WHERE schemaname='public'
UNION ALL SELECT 'views'    , count(*) FROM pg_views    WHERE schemaname='public'
UNION ALL SELECT 'functions', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
UNION ALL SELECT 'triggers' , count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
UNION ALL SELECT 'indexes'  , count(*) FROM pg_indexes  WHERE schemaname='public'
UNION ALL SELECT 'policies' , count(*) FROM pg_policies WHERE schemaname='public';
-- per-table rowcounts (use estimate; live exact count on small tables only)
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname;
```

### 2.2 Dump procedure (six dumps, ordered)

| # | Artifact | Command (parameters only) | Notes |
|---|---|---|---|
| 1 | **Schema only** (`01_schema.sql`) | `pg_dump --schema-only --schema=public --no-owner --no-acl --no-privileges` | Tables, sequences, types, views, defaults |
| 2 | **Functions + triggers** | included in `01_schema.sql` via `pg_dump` | `pg_dump` always emits these with `--schema-only` |
| 3 | **Indexes** | also in `01_schema.sql` | Verified by post-restore count = 131 |
| 4 | **RLS policies + GRANTs** (`02_policies.sql`) | `pg_dump --schema-only --section=post-data` filtered to `CREATE POLICY` and `GRANT` lines | Re-applied after data load to avoid replay-while-loading lock storms |
| 5 | **Data** (`03_data.sql.gz`) | `pg_dump --data-only --schema=public --disable-triggers --no-owner --column-inserts=false` (use `COPY`) `| gzip` | `--disable-triggers` so audit triggers don't fire during reload |
| 6 | **Seed/config tables only** (`04_seed.sql`) | `pg_dump --data-only --table=public.work_settings --table=public.cron_config --table=public.work_item_types --table=public.work_item_statuses --table=public.work_item_field_defs --table=public.org_roles --table=public.org_role_hierarchy --table=public.industry_templates --table=public.template_components --table=public.holiday_calendar --table=public.risk_rules_config` | Used by smoke-test environments without real customer data |

Additionally:

| Artifact | Source |
|---|---|
| `00_extensions.sql` | hand-authored — `CREATE EXTENSION` for `pgcrypto`, `uuid-ossp`, `pg_cron`, `pg_stat_statements` |
| `00_roles.sql` | hand-authored — `CREATE ROLE anon, authenticated, service_role, authenticator` with same GRANT shape Supabase uses |
| `00_auth_stub.sql` | hand-authored — `CREATE SCHEMA auth;` + `auth.uid()`, `auth.role()`, `auth.jwt()` reading `current_setting('request.jwt.claim.*', true)` |
| `00_cron_jobs.sql` | re-emit pg_cron entries (today the app uses external HTTP cron, but if any DB-side cron exists in `cron.job` it must be exported with `pg_dump --schema=cron`) |

**Total export wall time on current dataset:** estimated 3–8 minutes (schema is large but data volume is moderate). Run from a screen/tmux session.

### 2.3 Pre-flight checks during export

- `pg_dump --schema-only` must include all 61 functions, 36 triggers, 131 indexes, 102 policies — diff against `export_manifest.json`.
- `grep -c "CREATE POLICY" 01_schema.sql` ≥ 102.
- `grep -c "CREATE FUNCTION" 01_schema.sql` ≥ 61 (some appear as `CREATE OR REPLACE`).
- Reject the export if any object name resolves outside `public`/`auth`/`cron`.

---

## 3. DATABASE IMPORT PLAN

### 3.1 Initialization order (idempotent, runnable as `/docker-entrypoint-initdb.d/*.sql`)

```text
00_extensions.sql     -- pgcrypto, uuid-ossp, pg_cron, pg_stat_statements
00_roles.sql          -- anon, authenticated, service_role, authenticator
00_auth_stub.sql      -- auth.uid()/role()/jwt() reading request.jwt.claim.*
```

### 3.2 Migration order (run as `postgres` superuser via `psql -1 -v ON_ERROR_STOP=1`)

| Step | File | Notes |
|---|---|---|
| 1 | `01_schema.sql` | Creates tables, functions, triggers, indexes. **Skip** `CREATE POLICY` lines (they live in 02). Filter with `sed`. |
| 2 | Disable triggers session-wide: `SET session_replication_role = replica;` | Prevents audit/automation triggers from firing during bulk load |
| 3 | `03_data.sql.gz` (piped through `gunzip`) | Bulk `COPY` into every table |
| 4 | Re-enable triggers: `SET session_replication_role = origin;` | |
| 5 | `02_policies.sql` | Apply RLS + GRANTs after data is in place |
| 6 | `00_cron_jobs.sql` | Schedule any pg_cron jobs |
| 7 | `ANALYZE;` | Refresh planner stats |
| 8 | `SELECT pg_catalog.setval(...)` for every sequence | `pg_dump` already emits these, but re-verify `tasks_id_seq`, `work_item_types.id_seq` (per-type counter), `automation_*` sequences |

### 3.3 Post-import validation checks (must all pass before cutover)

```sql
-- 1. Object-count parity
SELECT
  (SELECT count(*) FROM pg_tables   WHERE schemaname='public') = 49 AS tables_ok,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') = 61 AS funcs_ok,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) = 36 AS triggers_ok,
  (SELECT count(*) FROM pg_indexes  WHERE schemaname='public') = 131 AS indexes_ok,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public') = 102 AS policies_ok;

-- 2. Per-table row counts vs source manifest (tolerance: 0 rows)
\copy (SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname) TO 'rowcounts.csv' CSV HEADER

-- 3. RLS is ENABLED on every public table that had it
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
-- expected: zero rows (any row → RLS not re-enabled by 02_policies)

-- 4. No invalid indexes (corruption during restore)
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;

-- 5. No broken FKs (every FK constraint reports validated)
SELECT conname FROM pg_constraint WHERE contype='f' AND NOT convalidated;

-- 6. Sequences ahead of MAX(id) (guard against duplicate-key on next insert)
-- Generated per table; assert next_val > max_id for tasks, attachments, etc.
```

A passing validation report is the **gate** for §6.

---

## 4. APPLICATION CHANGES

### 4.1 Environment variables

| Today (Supabase) | After migration | Set in |
|---|---|---|
| `VITE_SUPABASE_URL` = `https://<ref>.supabase.co` | `VITE_SUPABASE_URL` = `https://api.<app-domain>` (caddy → PostgREST) | Build env, `.env` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | unchanged (same JWT issuer secret) | `.env` |
| `SUPABASE_URL` (server) | `SUPABASE_URL` = `http://postgrest:3001` (inside `dbnet`) | Compose env |
| `SUPABASE_PUBLISHABLE_KEY` (server) | unchanged | Compose env |
| `SUPABASE_SERVICE_ROLE_KEY` | unchanged (Supabase still issues these for Auth/Storage) | Compose env |
| *(new)* | `DATABASE_URL` = `postgres://authenticator:***@pgbouncer:6432/app` | Compose env |
| *(new)* | `PGRST_JWT_SECRET` = **same secret Supabase uses** to sign JWTs | Compose env |
| *(new)* | `PGRST_DB_ANON_ROLE=anon` | Compose env |

> **Critical:** `PGRST_JWT_SECRET` must equal Supabase's JWT signing secret. Without it, app users' existing Supabase Auth tokens won't validate against the new PostgREST, and every request 401s.

### 4.2 Connection / pooling changes

- **PgBouncer in transaction mode**, `default_pool_size=20`, `max_client_conn=500`, `pool_mode=transaction`.
- **PostgREST → PgBouncer**, not directly to Postgres, so app traffic shares the pool. PostgREST's own internal pool: `PGRST_DB_POOL=10`.
- **App server-fn middleware** continues using the Supabase JS client; only its base URL changes. No code edits, only env.
- **Realtime + Storage**: still point at `supabase.co` — these env vars are unchanged.

### 4.3 Files requiring modification

Strictly minimal — only environment plumbing. **No business-logic file changes.**

| File | Change |
|---|---|
| `.env` (root) | Update `VITE_SUPABASE_URL` to the self-hosted PostgREST URL |
| `wrangler.jsonc` / Cloudflare env (if used) | Update `SUPABASE_URL` to internal `http://postgrest:3001` |
| `supabase/config.toml` | **Do not edit** — it is auto-generated and unused at runtime |
| `src/integrations/supabase/client.ts` | **No change.** Reads `VITE_SUPABASE_URL` at runtime. |
| `src/integrations/supabase/client.server.ts` | **No change.** Reads `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` at runtime. |
| `src/integrations/supabase/auth-middleware.ts` | **No change.** `getClaims(token)` still works because JWT secret is identical. |
| 8 cron handlers in `src/routes/api/public/hooks/` | **No change.** They use `supabaseAdmin` which honors the new `SUPABASE_URL`. |
| `docker-compose.yml` (new) | Add `postgres`, `pgbouncer`, `postgrest`, `pgbackrest`, `pgadmin?` services |
| `caddy/Caddyfile` (new or edited) | Route `api.<domain>` → `postgrest:3001`; keep `app.<domain>` → app |
| `ops/init/00_*.sql`, `01_schema.sql`, `02_policies.sql` (new) | Init scripts in §3 |
| `ops/pgbackrest.conf` (new) | Backup config |

**Total files touched in the application repo: 2** (`.env`, optional `wrangler.jsonc`). Everything else is new ops files.

---

## 5. ROLLBACK PLAN

### 5.1 Decision points

- **Before DNS cutover** (PostgREST URL still pointing to Supabase): rollback = no-op. Tear down Docker stack.
- **After DNS cutover, within 24 h**: cutback by reverting `VITE_SUPABASE_URL`/`SUPABASE_URL` env and redeploying the app. Estimated **3–5 minutes downtime**.
- **After 24 h with writes accepted**: requires dual-write replay (see 5.4). Avoid by keeping the 24 h window short.

### 5.2 Restore procedure (self-hosted DB corrupt or unreachable)

1. Stop `app` container so no further writes hit the broken DB.
2. From `pgbackrest`: `pgbackrest --stanza=app restore --type=time --target='YYYY-MM-DD HH:MM:SS+00'` against a fresh volume.
3. Bring up `postgres` + `pgbouncer` only; run validation §3.3.
4. Restart `postgrest` then `app`.
5. **Downtime estimate:** 10–30 min depending on backup size + WAL replay distance.

### 5.3 Cutback to Supabase (within 24 h window)

Prerequisite: keep the Supabase project alive and in read-only mode (do **not** delete) for at least 7 days post-cutover.

1. App: revert `VITE_SUPABASE_URL` and `SUPABASE_URL` to original Supabase values. Redeploy.
2. Dump deltas from self-hosted DB since cutover using a `(updated_at > cutover_ts)` predicate per table.
3. Apply deltas to Supabase via `psql` (RLS allows because we go in as `service_role`).
4. Verify counts; re-enable writes.
- **Downtime:** ~5 min for the env+redeploy step; delta replay happens with traffic live since Supabase is the source of truth again.

### 5.4 Cutback after 24 h (worst case)

- Use a `pg_dump --data-only` of self-hosted DB, restore into a staging Supabase clone, run a diff/merge tool against production Supabase, then promote.
- Engineering estimate: **1–2 days**. This is why the cutover window matters.

### 5.5 Backup cadence (post-cutover)

- WAL archiving: continuous (`archive_mode=on`, `archive_command=pgbackrest...`).
- Differential: every 6 h.
- Full: nightly 02:00 UTC, retained 14 days locally + 30 days off-VM.
- Restore drill: monthly into an ephemeral container; restore time must be < 30 min.

---

## 6. VALIDATION PLAN

Three layers, each fully automatable. All scripts can run from a CI container with `psql` + `bun`.

### 6.1 Schema parity (script: `ops/validate/01_schema.sh`)

- Connects to **both** old Supabase and new Postgres.
- Compares `pg_tables`, `pg_proc`, `pg_indexes`, `pg_policies`, `pg_trigger` row-by-row using `EXCEPT`.
- Fails if any object exists in one but not the other.

### 6.2 Data parity (script: `ops/validate/02_rowcounts.sh`)

- For each of the 49 tables: `SELECT count(*)` on both sides.
- For 6 critical tables (`tasks`, `comments`, `attachments`, `notifications`, `task_history`, `automation_runs`): also compare `md5(string_agg(md5(t::text), '' ORDER BY id))` over a recent window.
- Tolerance: **0** rows.

### 6.3 Behavior parity (script: `tests/migration/parity.spec.ts` — Playwright + direct PostgREST)

| Check | Source of truth |
|---|---|
| All 61 RPCs callable as `authenticated` | Call each via PostgREST `/rpc/<name>` with valid args, assert HTTP 200 / 204. Compare result hash to Supabase. |
| All 36 triggers fire | Insert/update/delete sentinel rows on `tasks`, `comments`, `eod_checkins`, `risk_events`, `carry_forward_events`. Assert side effects (`task_history` row, `automation_events` row, `notifications` row). |
| All 102 RLS policies enforce | Re-use existing `tests/services/*` Vitest suite, pointed at new PostgREST. Member sees own rows only; manager sees team rows; admin sees all. |
| 6 realtime subscriptions | Out of scope (Realtime stays on Supabase, still pointed at Supabase project). Smoke-test that subscriptions still fire after cutover. |
| 21 `.rpc(...)` call-sites in app | Run existing `bunx vitest run tests/services` + a focused Playwright sweep of `/today`, `/manager`, `/forecast`, `/executive`, `/configure/automations`. |

### 6.4 Sample validation queries (excerpted)

```sql
-- A. Every RLS-protected table actually has at least one policy
SELECT relname
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname);
-- expected: 0 rows

-- B. Every function present and executable
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
EXCEPT
SELECT unnest(ARRAY[/* 61 known names from MIGRATION_ASSESSMENT.md §1.2 */]);
-- expected: 0 rows

-- C. SECURITY DEFINER functions still owned by postgres (not authenticator)
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND prosecdef AND proowner <> (SELECT oid FROM pg_roles WHERE rolname='postgres');
-- expected: 0 rows
```

---

## 7. PERFORMANCE TEST PLAN

### 7.1 Workloads (run twice — pre-cutover on Supabase, post-cutover on self-hosted)

| # | Scenario | Driver | Metric |
|---|---|---|---|
| 1 | **Executive Dashboard** | `tests/integration/exec-summary-perf.test.ts` (existing) — calls `exec_summary(7)` × 50 concurrent | p50, p95, p99 latency; CPU on DB |
| 2 | **Automation Engine** | Enqueue 1000 events via `enqueue_automation_event`, let worker drain. | events/sec, queue depth peak, advisory-lock contention |
| 3 | **Workflow transitions** | k6 script: 500 concurrent users, each runs status change on a randomly-assigned task | p95 update latency, trigger fan-out time, version-conflict rate |
| 4 | **Approval Engine** | 200 approval requests, each with 3-step chain, decided concurrently | end-to-end approval latency, outbox lag |
| 5 | **Attachment metadata** | 1000 inserts into `attachments` (metadata only, no Storage call) + 1000 lists by `work_item_id` | insert p95, list p95 |

### 7.2 Acceptance criteria

| Metric | Supabase baseline | Self-hosted requirement |
|---|---|---|
| `exec_summary(7)` p95 | (measure first) | within ±15 % of baseline |
| Workflow transition p95 | (measure first) | within ±15 % of baseline |
| Automation events/sec | (measure first) | ≥ 90 % of baseline |
| Approval p95 | (measure first) | within ±15 % of baseline |
| Attachment list p95 | (measure first) | within ±15 % of baseline |

Tuning levers if any metric fails: `shared_buffers`, `work_mem`, `effective_cache_size`, `max_parallel_workers_per_gather`, PgBouncer `default_pool_size`, PostgREST `db-pool` size.

### 7.3 Observability during the test

- `pg_stat_statements` snapshot before and after each scenario; diff `total_exec_time`.
- `pgbouncer` `SHOW POOLS` every 10 s.
- `docker stats` for CPU/memory.
- Application: existing `operations_failures` table catches any RPC errors.

---

## 8. PILOT READINESS

### 8.1 Engineering effort

| Workstream | Days |
|---|---|
| Compose stack + extensions + auth stub | 1.0 |
| Export/import scripts + validation harness | 1.5 |
| PgBouncer + PostgREST tuning | 0.5 |
| pgbackrest config + restore drill | 1.0 |
| Performance test scripts (k6 + reuse existing Vitest) | 1.0 |
| Dry-run #1 (staging clone, throwaway) | 0.5 |
| Dry-run #2 (timed, including rollback rehearsal) | 0.5 |
| Documentation + runbook | 0.5 |
| Cutover window (live) | 0.5 |
| Buffer | 1.0 |
| **Total** | **8 engineer-days** (single backend engineer; can compress to ~5 calendar days with ops support) |

### 8.2 Downtime estimate (cutover window)

| Step | Duration |
|---|---|
| Freeze writes (app → 503 / read-only banner) | T+0 |
| Final `pg_dump` of delta since pre-cutover full dump | 3–8 min |
| Restore delta into self-hosted DB | 2–5 min |
| Run §3.3 validation queries | 1 min |
| Switch env (`VITE_SUPABASE_URL`, `SUPABASE_URL`) + redeploy app | 2–3 min |
| Smoke test 5 critical flows | 3 min |
| Unfreeze writes | T+~15 min |
| **Total user-visible downtime** | **10–20 min** (target: ≤ 15 min) |

### 8.3 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `auth.uid()` returns NULL after cutover (RLS denies all) | Medium | Critical | Auth stub functions + matching `PGRST_JWT_SECRET` verified in dry-run; smoke test signs in as each of qa-admin / qa-manager / qa-member |
| Sequence drift → duplicate-key error on first insert | Medium | High | §3.2 step 8 — `setval` for every sequence; post-restore validation query |
| pg_cron jobs not re-scheduled | Low | Medium | App cron is external HTTP (Lovable cron hitting `/api/public/hooks/*`) — unaffected. Verify no `cron.job` rows exist in the Supabase source; if any, re-emit in `00_cron_jobs.sql`. |
| PgBouncer transaction-mode breaks prepared statements | Low | Medium | PostgREST does not use server-side prepared statements by default; app uses `@supabase/postgrest-js` which is REST → safe |
| Performance regression on `exec_summary` (uses 32 MB `work_mem`) | Low | Medium | Self-hosted Postgres `work_mem=32MB` matches; verify via §7 |
| Backup not actually restorable | Low | Critical | Mandatory monthly restore drill into ephemeral container — written into runbook |
| JWT secret leakage during copy from Supabase to compose env | Medium | Critical | Use sealed-secret / Doppler / SOPS; never paste into chat or commit |
| Off-VM backup destination unreachable during incident | Low | High | Local 14-day retention covers most restores; off-VM is for DR only |

### 8.4 Success probability

| Confidence | Conditions |
|---|---|
| **90 %** | Two clean dry-runs against a staging copy + monthly restore drill + perf within ±15 % |
| **75 %** | One dry-run only |
| **50 %** | No dry-run, go straight to cutover |

**Recommended posture:** do not schedule the live cutover until **two dry-runs pass end-to-end and one restore drill succeeds within 30 min**. With those gates the migration is **low-risk** because Auth/Storage/Realtime stay on Supabase, the schema is 100 % portable Postgres, and the app code requires no logic edits.

---

*End of plan. No code or migrations produced.*

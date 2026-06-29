# SELF-HOSTED MIGRATION PLAN — Supabase Exit Assessment

**Date:** 2026-06-19
**Author:** Platform Engineering
**Scope:** Full exit from Supabase (managed) to a self-hosted stack running on Docker:
PostgreSQL · MinIO · Redis · Nginx · Node (TanStack Start) backend.
**Status:** Assessment only — no code changes. Supersedes MIGRATION_ASSESSMENT.md
(DB-only) and POSTGRES_MIGRATION_PLAN.md (DB-only) for the *full exit* scenario.

---

## 0. TL;DR

| Metric | Value |
|---|---|
| Overall Supabase coupling | **6.5 / 10** (Moderate) |
| Total estimated effort | **22 – 30 engineer-days** (1 backend + 1 ops, parallel) |
| Schema portability | 100 % (pure PostgreSQL) |
| Zero-functional-loss feasible? | **Yes**, conditional on GoTrue (or equivalent) preserving `auth.uid()` semantics and a Redis-backed pub/sub bridge replacing 6 realtime subscriptions |
| Critical blockers | **0 hard blockers.** 3 high-risk items (Auth, Realtime, Storage signed URLs) — all have proven OSS replacements |
| Recommended target | Docker Compose on a single VM: `postgres:16` + `gotrue` + `postgrest` + `minio` + `redis:7` + `nginx` + app container |

---

## 1. Complete Supabase Dependency Inventory

### 1.1 Database (Level 0 — fully portable)
- **49 tables** (public schema), **131 indexes**, **1 view** (`profile_emails`).
- **61 PL/pgSQL functions**, **36 user triggers**, **21 distinct `.rpc()` call-sites** in app code.
- **102 RLS policies** across 47 user-facing tables (70 reference `auth.uid()`).
- **35 migration files** on disk (`supabase/migrations/`).
- Zero Supabase-proprietary SQL features. `pg_dump` / `pg_restore` round-trips cleanly.

### 1.2 Auth (Level 2 — medium)
| Surface | Count | Notes |
|---|---|---|
| `supabase.auth.signInWithPassword` | 1 | `src/routes/login.tsx` |
| `supabase.auth.signUp` | 1 | `src/routes/login.tsx` |
| `supabase.auth.signOut` | 1 | `src/hooks/use-auth.ts` |
| `supabase.auth.getSession` | 9 | session-attach + landing redirect |
| `supabase.auth.getUser` | 8 | actor-id lookups in services |
| `supabase.auth.onAuthStateChange` | 2 | `__root.tsx`, `use-auth.ts` |
| `supabase.auth.getClaims(token)` | 1 | `src/integrations/supabase/auth-middleware.ts` (server JWT verify) |
| Google OAuth | yes | configured via Lovable Cloud broker today |
| `handle_new_user` trigger on `auth.users` | 1 | creates profile + first-user-admin |
| `auth.uid()` references in SQL | **70 policies + 14 functions** |
| FKs from `public.*` → `auth.users` | **0** (verified) — all FKs use `profiles.id` |

### 1.3 Storage (Level 1 — easy/medium)
- **1 bucket:** `work-item-files` (private).
- **6 `.storage` call-sites:** `services/attachments.ts` (4) + `lib/offline-queue.ts` (2).
- Path layout: `{work_item_id}/{uuid}-{filename}`.
- Signed-URL TTL: 300 s (1 call site).
- Size cap 20 MB; MIME allowlist enforced client-side in `attachments.ts`.
- No `getPublicUrl` usage. No CDN dependency.

### 1.4 Realtime (Level 1 — drop or shim)
6 `postgres_changes` subscriptions. **None on the write hot path** — all are convenience refreshers.

| File | Table | Class |
|---|---|---|
| `hooks/use-realtime-tasks.ts` | `tasks` | Optional |
| `components/NudgeCenter.tsx` | `nudges` | Optional |
| `components/SuggestionsPanel.tsx` | `planning_suggestions` | Optional |
| `components/AppShell.tsx` | `notifications` | Required-ish (header badge) |
| `routes/_authenticated/command.tsx` | `risk_events` | Optional |
| `routes/_authenticated/dashboard.tsx` | `tasks` | Optional |

### 1.5 Edge Functions
**None.** App-internal logic runs through TanStack `createServerFn`. There are no `supabase/functions/*` directories in this project.

### 1.6 Cron Jobs (Level 0)
8 public HTTP hooks under `src/routes/api/public/hooks/`:
`adoption-rollup`, `automation-due-enqueue`, `automation-tick`, `carry-forward`,
`detect-risks`, `evening-digest`, `generate-nudges`, `morning-digest`,
`planning-suggestions`, `workload-snapshot`. All Bearer-authed via `requireCronAuth`.
Replaceable 1-for-1 by `pg_cron` jobs or host `cron` calling the same endpoints.

### 1.7 RLS — 102 policies on 47 tables
70 policies reference `auth.uid()` directly. RLS is enabled on every user-facing
table. After exit, the new JWT layer **must** set `request.jwt.claim.sub` (GoTrue
does this natively via PostgREST) **or** policies must be rewritten to read a
custom GUC (`current_setting('app.user_id')`). The GoTrue path = 0 rewrites.

### 1.8 RPC Functions
21 distinct `.rpc()` call-sites covering: exports, templates, predictions, tasks,
config-snapshots, carry-forward, automations, executive summary, automation worker,
and all 8 cron handlers. Each maps directly to a PostgREST `/rpc/<name>` endpoint —
zero call-site changes if PostgREST is kept.

### 1.9 Client Inventory (touch surface)
| Area | Count |
|---|---|
| `.from(...)` | **150** sites across `services/*`, `routes/*`, `components/*` |
| `.rpc(...)` | **21** |
| `.storage` | **6** |
| `.auth.*` | **25** |
| `.channel + postgres_changes` | **6** subscriptions |
| Files touching `supabase` import | **91** |
| `createClient` instances | **3** (`client.ts`, `client.server.ts`, `auth-middleware.ts`) |

---

## 2. Dependency Classification

| Dependency | Class | Why |
|---|---|---|
| Schema, indexes, views | **Easy** | Pure Postgres — `pg_dump`/`pg_restore` |
| 61 functions + 36 triggers | **Easy** | Pure PL/pgSQL |
| 21 RPC call-sites | **Easy** | PostgREST `/rpc/<name>` is drop-in |
| 150 `.from(...)` queries | **Easy** | One client file changes URL/anon-key |
| 102 RLS policies | **Easy** (with GoTrue) / **Medium** (custom JWT) | `auth.uid()` keeps working under GoTrue |
| Cron (8 hooks) | **Easy** | `pg_cron` or host crontab → same URLs |
| Storage (6 calls, 1 bucket) | **Medium** | MinIO presigned URLs; rewrite `attachmentsService` + offline uploader |
| Auth (25 sites + Google OAuth + new-user trigger) | **Medium** | Deploy GoTrue + reconfigure Google client + replace `handle_new_user` with webhook |
| Realtime (6 subs) | **Medium** | Drop + `refetchInterval`, **or** Redis pub/sub bridge over WebSocket |
| `handle_new_user` trigger on `auth.users` | **Medium** | New-user webhook from GoTrue → server-fn that inserts profile + admin role |
| `attachSupabaseAuth` + `requireSupabaseAuth` | **Easy** | Same Bearer plumbing; swap `getClaims` for `jose.jwtVerify` |
| Lovable Cloud secrets (`sb_secret_*`) | **Easy** | Rotate to 64-char `JWT_SECRET` you control |
| **Critical blockers** | **None** | Every dependency has a proven OSS replacement |

---

## 3. Required Architecture Changes

### 3.1 Frontend
- **Keep:** all React components, TanStack routes, services, query hooks.
- **Change:** `src/integrations/supabase/client.ts` env vars only (`VITE_SUPABASE_URL` → self-hosted PostgREST/GoTrue URL; same publishable key shape).
- **Optionally rename** alias `@/integrations/supabase` → `@/integrations/backend` as a cosmetic pass — out of scope for the cutover sprint.
- **Realtime:** either delete the 6 `useEffect` subscribers and add `refetchInterval: 30000`, or point `.channel()` at a thin Redis-backed WebSocket bridge that mimics the `postgres_changes` envelope.

### 3.2 Backend (TanStack Start, Node)
- **Keep:** every `createServerFn`, every `src/routes/api/public/hooks/*` cron handler, all 8 middleware files.
- **Change:** `src/integrations/supabase/auth-middleware.ts` — replace `supabase.auth.getClaims()` with `jose.jwtVerify(token, JWKS)` against GoTrue's `/jwks` endpoint. Same `context.userId` / `context.claims` shape preserved for callers.
- **Change:** `src/integrations/supabase/client.server.ts` — point at internal Postgres/PostgREST and use a locally-rotated service key. Keep the same `Database` typing.
- **Add:** Redis client wrapper (`src/integrations/redis/client.server.ts`) for: (a) automation queue back-pressure metrics, (b) optional realtime fan-out, (c) rate-limit counters currently kept in-memory.

### 3.3 Database
- **Postgres 16** in Docker with `pg_cron`, `pgcrypto`, `uuid-ossp`, `pgjwt` extensions.
- Pre-create `auth` schema with stub `auth.users` (id, email, raw_user_meta_data) **only if** GoTrue is used (GoTrue owns it). Stub `auth.uid()` / `auth.role()` / `auth.jwt()` functions read `current_setting('request.jwt.claim.*', true)`.
- `pgbackrest` sidecar for WAL-level backups to off-VM object storage (or MinIO bucket `backups`).
- `pgbouncer` (transaction mode) in front for pool reuse.

### 3.4 Authentication
- **GoTrue** container (official `supabase/gotrue` image is Apache-2.0; or `keycloak` if a richer admin UI is required).
- SMTP transport for password resets + email confirmation.
- Google OAuth: re-issue OAuth client with the new redirect URL (`https://<host>/auth/v1/callback`).
- Replace `handle_new_user` trigger with a GoTrue webhook → `POST /api/public/hooks/new-user` (HMAC-verified) that inserts the `profiles` row and grants `admin` to the first user.

### 3.5 File Storage
- **MinIO** with one bucket `work-item-files` (private, versioning on).
- Rewrite `src/services/attachments.ts` to use `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Public surface (`uploadFile`, `getSignedUrl`, `deleteFile`) preserved so callers don't change.
- Offline queue (`src/lib/offline-queue.ts`) replays uploads via the same wrapper.
- Backups: `mc mirror minio/work-item-files /backup/minio` on host cron.

### 3.6 Realtime
Choose one (both feasible; pick before Phase 5):
- **Option A — Drop entirely**: replace 6 subscriptions with React Query `refetchInterval` (15–30 s). **Pros:** zero infra; **Cons:** notification badge lag.
- **Option B — Redis pub/sub bridge** (~250 LoC Node service): Postgres triggers `pg_notify(channel, json)` → bridge consumes via `LISTEN/NOTIFY`, fans out over Redis pub/sub, exposes a WebSocket endpoint that mimics the `postgres_changes` event shape. Browser keeps `.channel()` API.
- **Anti-recommendation:** self-host the Supabase Realtime (Elixir) container — re-introduces the stack you're exiting.

### 3.7 Reverse Proxy
- **Nginx** terminates TLS, routes:
  - `/auth/v1/*` → GoTrue:9999
  - `/rest/v1/*` → PostgREST:3000
  - `/storage/v1/*` → MinIO:9000 (presigned URL host)
  - `/realtime/v1/*` → Redis bridge:8081 (if Option B)
  - `/*` → app container:8080
- Single TLS cert (Let's Encrypt via `certbot` or `caddy`).

---

## 4. Migration Phases

| Phase | Goal | Days | Parallelizable? |
|---|---|---|---|
| **0. Baseline & dry-run env** | Stand up Compose stack, restore `pg_dump` snapshot, run vitest + Playwright against it | 2 | — |
| **1. Backend abstraction** | Introduce `@/integrations/backend` aliases; swap `getClaims` → `jose.jwtVerify`; add JWKS fetch | 3 | with Phase 2 |
| **2. PostgreSQL migration** | Final cutover script: schema → data → policies; pgbouncer + pg_cron jobs; verify 36 triggers + 21 RPCs | 3 | with Phase 1 |
| **3. MinIO migration** | Deploy MinIO; rewrite `attachmentsService` + offline uploader; `mc mirror` historical objects | 2 | with Phase 2 |
| **4. Auth migration** | Deploy GoTrue; Google OAuth re-issue; new-user webhook; `handle_new_user` trigger removed | 4 | after Phase 1 |
| **5. Realtime migration** | Implement chosen option (drop + polling, or Redis bridge) | 2 | after Phase 2 |
| **6. Cron + ops hardening** | `pg_cron` jobs; `pgbackrest`; alerting on `operations_failures` | 1.5 | with Phase 5 |
| **7. End-to-end QA sweep** | Rerun adversarial Playwright suite × 3 roles; load test exec_summary, automation worker, approvals | 2.5 | — |
| **8. Cutover** | Freeze writes ≤ 20 min; `pg_dump` delta restore; DNS flip; smoke tests | 1 | — |
| **9. Buffer / unknowns** | Reserved | 1.5 | — |
| **Total** | | **22 – 30** | |

---

## 5. Files / Routes / Services / Components Affected

### 5.1 Files that **change** (16)
| File | Change |
|---|---|
| `src/integrations/supabase/client.ts` | URL/anon-key env swap; keep `createClient` shape |
| `src/integrations/supabase/client.server.ts` | URL/service-key env swap |
| `src/integrations/supabase/auth-middleware.ts` | `getClaims` → `jose.jwtVerify`; same context shape |
| `src/integrations/supabase/auth-attacher.ts` | No code change; verify bearer is the GoTrue JWT |
| `src/services/attachments.ts` | S3 SDK in place of `.storage`; preserve public API |
| `src/lib/offline-queue.ts` | Use new uploader wrapper (lines 179, 192) |
| `src/routes/login.tsx` | No code change; verify Google redirect URL |
| `src/hooks/use-auth.ts` | No code change |
| `src/routes/__root.tsx` | No code change |
| `src/hooks/use-realtime-tasks.ts` | Drop or repoint to bridge |
| `src/components/NudgeCenter.tsx` | Drop or repoint |
| `src/components/SuggestionsPanel.tsx` | Drop or repoint |
| `src/components/AppShell.tsx` | Drop or repoint (notification badge) |
| `src/routes/_authenticated/command.tsx` | Drop or repoint |
| `src/routes/_authenticated/dashboard.tsx` | Drop or repoint |
| `.env` / `wrangler.jsonc` / Compose env | New variable names; `JWT_SECRET`, `DATABASE_URL`, `S3_*`, `REDIS_URL` |

### 5.2 Files that **stay byte-identical** (75+)
- All 30+ files in `src/services/*` except `attachments.ts`
- All 25+ files in `src/routes/_authenticated/*`
- All 8 cron handlers in `src/routes/api/public/hooks/*`
- All `src/components/*` except 5 listed above
- All `src/lib/*.functions.ts` (forecast, executive, manager, my-day, qa-seed)
- All `tests/*`

### 5.3 New files (8 – 10)
- `docker-compose.yml`, `nginx/conf.d/app.conf`, `gotrue/config.env`,
  `postgres/init/00_auth_stub.sql` (only if GoTrue not adopted),
  `minio/policy.json`, `realtime-bridge/` (Option B only),
  `scripts/migrate-export.sh`, `scripts/migrate-import.sh`,
  `scripts/storage-mirror.sh`, `pgbackrest/pgbackrest.conf`.

### 5.4 Database objects
- 0 schema rewrites required.
- 1 trigger to drop (`handle_new_user` on `auth.users`) once GoTrue webhook is live.
- 8 `pg_cron` job rows to insert.

---

## 6. Risk Assessment

### 6.1 Data loss risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Lost rows during dump/restore window | Low | Two dry-runs; final `pg_dump --no-owner --no-acl` after write freeze; row-count + MD5 parity check before DNS flip |
| Orphaned storage objects after MinIO mirror | Low | `attachments.storage_path` is authoritative; reconciliation script lists `attachments` ⨯ `mc ls` |
| Lost auth users (no FKs to `auth.users` from public — verified) | None | Import GoTrue users from `auth.users` dump via Admin API; password hashes preserved (bcrypt — GoTrue-compatible) |
| Realtime backlog dropped during cutover | Low | Polling fallback active for 24 h post-cutover regardless of chosen option |

### 6.2 Downtime risks
| Phase | Expected window |
|---|---|
| Write freeze + final delta restore | **10 – 20 min** |
| DNS TTL propagation | depends on TTL (set to 60 s 24 h before cutover) |
| Total user-visible downtime | **< 30 min** with rehearsed runbook |

### 6.3 Security risks
| Risk | Mitigation |
|---|---|
| `JWT_SECRET` leakage | 64-char secret, stored only in Compose `.env` (chmod 600); rotate after cutover |
| MinIO root creds in env | Use scoped IAM-style users for app; root only for `mc admin` |
| RLS regression (custom GUC path) | **Avoid:** keep GoTrue so `auth.uid()` is unchanged |
| Webhook spoofing (new-user, cron) | HMAC verification + `requireCronAuth` already in place |
| TLS misconfig at Nginx | `caddy` alternative auto-manages certs; otherwise certbot + HSTS preload |
| Lovable Cloud `sb_secret_*` key leak window | Rotate at Supabase before final cutover; old keys cannot reach the new DB anyway |
| Backup encryption | `pgbackrest` AES-256 + GPG key on separate VM |

### 6.4 Rollback plan
1. Keep Supabase project **fully online and writable** for 7 days post-cutover.
2. DNS rollback flips `VITE_SUPABASE_URL` back; no schema diverged because the period is read-only on Supabase after cutover (writes were paused during the freeze, then cut to self-hosted).
3. If divergence is detected within 7 days: `pg_dump` from self-hosted → restore deltas to Supabase via `pg_restore --data-only --table=...`.
4. Storage rollback: `mc mirror` MinIO → Supabase Storage; signed URL TTL absorbs the gap.
5. After 7 days of clean operation, Supabase project is archived (snapshot exported), then deleted.

---

## 7. Engineering Effort Estimate (recap)

| Phase | Days |
|---|---|
| 0. Baseline / dry-run | 2 |
| 1. Backend abstraction | 3 |
| 2. Postgres migration | 3 |
| 3. MinIO | 2 |
| 4. Auth (GoTrue) | 4 |
| 5. Realtime | 2 |
| 6. Cron + ops | 1.5 |
| 7. QA sweep | 2.5 |
| 8. Cutover | 1 |
| 9. Buffer | 1.5 |
| **Total** | **22.5** (range 22 – 30 with 1 backend + 1 ops in parallel) |

---

## 8. Final Recommendation

### 8.1 Zero functional loss?
**Yes — conditional on three decisions:**
1. **Adopt GoTrue** as the auth layer (preserves `auth.uid()` semantics → zero RLS rewrites).
2. **Keep PostgREST** in front of Postgres (preserves all 150 `.from(...)` and 21 `.rpc(...)` call-sites).
3. **Choose realtime path before Phase 5** — polling fallback is acceptable for 5 of 6 subscriptions; only the header notification badge benefits from a push bridge.

Any deviation (custom JWT, hand-rolled REST layer, killing realtime without polling) introduces functional regression and lengthens the sprint by 4 – 8 days.

### 8.2 Top 10 blockers (ranked by risk × effort)
1. **Auth migration — `handle_new_user` trigger + Google OAuth re-issue + first-user-admin logic** (Phase 4, 4 days, touches sign-up flow).
2. **`auth.uid()` in 70 RLS policies + 14 functions** — locks in GoTrue choice.
3. **Storage rewrite + offline-queue re-plumb** (`attachments.ts` + `offline-queue.ts`) — touches the field-mobile flow that Phase E3 hardened.
4. **Realtime fallback decision** — affects UX of `AppShell` notification badge; needs product sign-off.
5. **Lovable Cloud secret format (`sb_secret_*`) → `JWT_SECRET` swap** — coordinate across env, CI, and any external integrations.
6. **8 cron hooks → `pg_cron`** — must verify each job's idempotency (already designed to be, but needs proof under new scheduler).
7. **`pgbackrest` / DR posture** — moves from Supabase-managed to self-owned; 24 h restore drill mandatory before cutover.
8. **DNS TTL window** — coordinate 24 h ahead; uncontrolled CDN caches can persist > 5 min.
9. **MinIO object historical mirror** — first `mc mirror` of ~N GB may take hours; needs warm copy before freeze window.
10. **Test infrastructure (Playwright + vitest)** — must run green against Compose stack before any production traffic is cut.

### 8.3 Safest implementation order
```
[ Week 1 ]  Phase 0  → dry-run env reproducible
[ Week 1 ]  Phase 1  ‖ Phase 2     (abstraction + DB on the dry-run env)
[ Week 2 ]  Phase 4              (Auth — gated by Phase 1 JWKS work)
[ Week 2 ]  Phase 3  ‖ Phase 5    (Storage + Realtime in parallel)
[ Week 3 ]  Phase 6              (Cron + ops hardening)
[ Week 3 ]  Phase 7              (Full QA sweep, 3 roles)
[ Week 3 ]  Phase 8              (Cutover — Saturday 02:00 local, 30-min window)
[ +7 days ] Decommission Supabase project after stable run
```

**Hard gates between phases:**
- No Phase 4 start until Phase 1 lands `jose.jwtVerify` against a real JWKS endpoint.
- No Phase 8 cutover until Phase 7 reports green Playwright × 3 roles + p95 latency parity within 20 % of Supabase baseline.
- No Supabase decommission until 7 calendar days of clean self-hosted operation + verified `pgbackrest` restore drill.

---

*End of assessment. No code modified. No migration performed.*

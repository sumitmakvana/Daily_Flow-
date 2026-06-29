# PHASE MT-0 — Supabase → Self-Hosted PostgreSQL Migration Assessment

**Date:** 2026-06-19  
**Scope:** Replace Supabase (managed) with a self-hosted PostgreSQL container running on the same VM as the application.  
**Method:** Static audit of `src/`, live introspection of the live database, and inventory of integration points. **No code changes were made.**

---

## 0. TL;DR

| Metric | Value |
|---|---|
| **Current dependency score** | **6.5 / 10** (Moderate — schema is portable, but Auth, Storage, Realtime, Edge env, and the bearer-token RPC pipeline are Supabase-shaped) |
| **Estimated migration effort** | **12 – 18 engineer-days** (1 backend + 1 ops, in parallel) |
| **Schema portability** | **100 %** — pure PostgreSQL, no Supabase-proprietary SQL features |
| **Recommended path** | Postgres-in-Docker + GoTrue (or Lucia/custom JWT) + MinIO + Postgres `LISTEN/NOTIFY` shim + thin server-side data layer replacing the publishable-key client. App code in `src/` keeps its `supabase.from(...)` shape via a compatibility wrapper for ~80 % of call-sites. |

---

## 1. Database Inventory (live introspection)

| Object | Count |
|---|---|
| Tables (public) | **49** |
| Views (public) | **1** (`profile_emails`, `security_invoker`) |
| Materialized views | 0 |
| Functions (public) | **61** |
| Triggers (public, non-internal) | **36** |
| Indexes (public) | **131** |
| RLS policies | **102** (70 reference `auth.uid()`) |
| Migration files on disk | 35 |

### 1.1 Tables (all 49)
`adoption_daily, approval_chains, approval_decisions, approval_outbox_events, approval_requests, approval_steps, attachments, audit_exports, audit_log, automation_action_log, automation_events, automation_queue_stats, automation_rules, automation_runs, carry_forward_events, comment_mentions, comments, config_snapshots, cron_config, cron_invocations, daily_workload_snapshot, eod_checkins, holiday_calendar, industry_templates, notification_prefs, notifications, nudges, operations_failures, org_role_hierarchy, org_roles, planning_suggestions, profiles, projects, risk_events, risk_rules_config, task_history, tasks, teams, template_components, tenant_onboarding, user_org_roles, user_roles, user_streaks, work_item_field_defs, work_item_relations, work_item_statuses, work_item_transitions, work_item_types, work_settings`

### 1.2 RPC / Functions (61)
All are pure PL/pgSQL or SQL — **no Supabase-proprietary extensions used**. Notable groups:

- **Auth helpers (must rewrite to use new JWT claim):** `has_role`, `has_org_role`, `is_manager_or_admin`, `is_request_approver`, `manager_visible_team_ids`, `notify_task_blocked`, `record_export`, `snapshot_config`, `restore_config`, `install_template`, `purge_*` (5), `automation_set_depth`, `predict_tomorrow_risks`, `exec_summary` — **all rely on `auth.uid()`**.
- **Pure data/maintenance (zero changes):** `_current_automation_depth`, `bump_user_streak`, `capture_config_payload`, `compute_task_sla`, `enqueue_automation_event`, `generate_nudges`, `generate_planning_suggestions`, `next_working_day`, `set_task_code`, `tasks_bump_version`, `tasks_default_type`, `tasks_sync_status`, `tasks_validate_custom_fields`, `tasks_enforce_completion_fields`, `update_updated_at_column`, all `trg_*` triggers, `automation_try_lock`, `automation_unlock`.
- **Triggers wiring `auth.uid()` for audit:** `log_task_change`, `enforce_task_field_perms`, `on_carry_forward_event`, `on_approval_decision`, `on_comment_mention`, `protect_system_org_roles`.
- **One trigger references `auth.users`:** `handle_new_user` — fires `ON INSERT` to `auth.users`. **Must be replaced** by a post-signup hook in the new auth layer.

### 1.3 RLS Policies (102 total, 70 reference `auth.uid()`)
Every user-facing table has RLS enabled with `auth.uid()`-scoped policies. After migration, the new auth layer **must continue setting `request.jwt.claim.sub`** (GoTrue does this natively) or the policies must be rewritten to read a custom GUC (e.g. `current_setting('app.user_id')`).

---

## 2. Supabase Auth Usage in App Code

| Symbol | Occurrences (src/) | Migration complexity |
|---|---|---|
| `supabase.auth.getSession()` | 9 | **Low** — wraps a JWT in localStorage; same shape under GoTrue |
| `supabase.auth.getUser()` | 8 | **Low** — `/user` endpoint, identical under GoTrue |
| `supabase.auth.signInWithPassword` | 1 (`login.tsx:63`) | **Low** |
| `supabase.auth.signUp` | 1 (`login.tsx:54`) | **Low** |
| `supabase.auth.signOut` | 1 (`use-auth.ts:39`) | **Low** |
| `supabase.auth.onAuthStateChange` | 2 (`use-auth.ts`, `__root.tsx`) | **Medium** — GoTrue ships the same API; rolling your own JWT layer means writing this listener manually |
| `supabase.auth.getClaims(token)` | 1 (`auth-middleware.ts:63`) | **Medium** — server-side JWT verify; rewrite with `jose` or `jsonwebtoken` |
| `auth.uid()` in SQL | 70 policies + 14 functions | **Low if GoTrue / Medium if custom** — keep policies identical with GoTrue; otherwise rewrite to a GUC |
| `auth.users` (FK / trigger) | 1 trigger (`handle_new_user`) | **Medium** — replace with new-user webhook |
| `auth.role()`, `auth.jwt()` | 0 in app, 0 in SQL | n/a |

**Key call-site file map**

| File | Line | What it does |
|---|---|---|
| `src/routes/login.tsx` | 41, 54, 63 | session check, signUp, signInWithPassword |
| `src/routes/index.tsx` | 8 | getSession for landing redirect |
| `src/routes/__root.tsx` | 55 | onAuthStateChange → invalidate router |
| `src/hooks/use-auth.ts` | 13, 17, 39 | listener + signOut |
| `src/integrations/supabase/auth-middleware.ts` | 46, 63 | server-side token verify (`getClaims`) |
| `src/integrations/supabase/auth-attacher.ts` | 9 | attach bearer to server-fn calls |
| `src/routes/_authenticated.tsx` | 36, 52 | route gate |
| `src/services/approvals.ts`, `org-roles.ts`, `automations.ts`, `relations.ts` | (various) | `getUser()` for actor ID |
| `src/components/fields/PhotoField.tsx`, `SignatureField.tsx` | 57, 67 | `getUser()` for attachment owner |

---

## 3. Supabase Client Inventory

| Area | Count | Representative Files |
|---|---|---|
| **Database queries** (`.from(...)`) | **150** | `src/services/*` (~30 files), `src/routes/_authenticated/*` (~20 routes), `src/components/*` |
| **RPC calls** (`.rpc(...)`) | **21** | `services/{exports,templates,predictions,tasks,config-snapshots,carry-forward,automations}.ts`, `lib/{executive,automation/worker.server}.ts`, all 8 cron handlers in `src/routes/api/public/hooks/` |
| **Storage calls** (`.storage`) | **6** | `src/services/attachments.ts` (4), `src/lib/offline-queue.ts` (2) |
| **Auth calls** (`.auth.*`) | **25** | see §2 |
| **Realtime** (`.channel + postgres_changes`) | **6 subscriptions** | `hooks/use-realtime-tasks.ts`, `components/NudgeCenter.tsx`, `components/SuggestionsPanel.tsx`, `components/AppShell.tsx`, `routes/_authenticated/command.tsx`, `routes/_authenticated/dashboard.tsx` |
| **`createClient`** | 3 instances | `client.ts` (browser, publishable), `client.server.ts` (admin/service), `auth-middleware.ts` (per-request bearer) |
| **Files touching Supabase total** | **91** | — |

Code is well-isolated: 100 % of DB calls go through `@/integrations/supabase/client` or `client.server` — there is **one shim layer to swap**.

---

## 4. Storage Audit

- **Buckets used:** **1** — `work-item-files` (private)
- **Upload paths:** `{work_item_id}/{uuid}-{filename}` (see `src/services/attachments.ts:43`)
- **Signed URLs:** 1 call site (`attachments.ts:75`), TTL = 300 s
- **File validations:** size cap 20 MB; MIME allowlist (`image/*`, `audio/*`, `text/*`, PDF, Office, CSV) — all enforced in `attachments.ts` (`isAllowedMime`)
- **Public URLs / `getPublicUrl`:** **0**
- **Offline sync writes:** `src/lib/offline-queue.ts:179, 192` (background uploader)

**Migration effort estimates**

| Target | Effort | Notes |
|---|---|---|
| **Local filesystem (single-VM)** | **0.5 – 1 day** | Wrap `attachmentsService` with a `fetch('/api/files/...')` server route; signed URLs become short-lived HMAC tokens. Backup story = `pg_dump` + `tar` of the volume. |
| **MinIO (recommended for self-host)** | **1 – 1.5 days** | Drop-in S3 API; reuse the `@supabase/storage-js`-shaped surface via the AWS SDK v3 or `@aws-sdk/s3-request-presigner`. Same bucket layout works as-is. |
| **AWS S3 / R2** | **1 – 2 days** | Same as MinIO; add IAM / R2 token plumbing. Defeats the "single VM" goal but easiest for DR. |

---

## 5. Realtime Audit

6 `postgres_changes` subscriptions. **None is on the hot path of writes** — all are convenience refreshers.

| File | Channel | Table | Classification |
|---|---|---|---|
| `hooks/use-realtime-tasks.ts` | `tasks-*` | `tasks` | **Optional** (debounced refetch; could poll every 30 s) |
| `components/NudgeCenter.tsx` | `nudges-{userId}` | `nudges` | **Optional** |
| `components/SuggestionsPanel.tsx` | `planning-suggestions-rt` | `planning_suggestions` | **Optional** |
| `components/AppShell.tsx` | `notif-count` | `notifications` | **Required-ish** (header badge UX) |
| `routes/_authenticated/command.tsx` | `risk-rt` | `risk_events` | **Optional** |
| `routes/_authenticated/dashboard.tsx` | `dash` | `tasks` | **Optional** |

**Notification streams (other than realtime):** none — `onAuthStateChange` is the only push channel besides the 6 above.

**Replacement options**
1. **Drop entirely**, replace with React Query `refetchInterval: 30000` on the same queries — **0.5 day**, zero infra.
2. **Postgres `LISTEN/NOTIFY` over WebSocket** via a tiny Node/Bun bridge (~200 LoC) — **2 days**, keeps push semantics.
3. **Self-host Supabase Realtime container** (Elixir) — **1 day** to deploy, but you inherit Supabase's stack again. **Not recommended** if the goal is independence.

---

## 6. Migration Strategy & Dependency Levels

| Dependency | Level | Why |
|---|---|---|
| Schema (49 tables, 131 indexes) | **0** | Pure Postgres — `pg_dump` → `pg_restore` |
| 61 SQL functions + 36 triggers | **0** | Pure PL/pgSQL |
| 102 RLS policies (incl. `auth.uid()`) | **0 if GoTrue / 1 if custom JWT** | GoTrue keeps `request.jwt.claim.sub` populated identically; otherwise GUC rewrite |
| 150 `.from(...)` query call-sites | **1** | One file (`client.ts`) chooses the URL; PostgREST self-hosted is drop-in. **Or** swap to a thin Node Postgres data layer behind the same surface (more work but no PostgREST dependency). |
| 21 `.rpc(...)` calls | **1** | PostgREST `/rpc/<name>` works identically; otherwise wrap in server-fn handlers |
| Storage (6 calls, 1 bucket) | **1** | MinIO / local FS — covered in §4 |
| Auth (25 call sites) | **2** | GoTrue self-host is the lowest-friction path. Custom JWT auth = ~3 days extra. |
| Realtime (6 subscriptions) | **1** (all classified Optional / Required-ish) | Drop or LISTEN/NOTIFY shim |
| `handle_new_user` trigger on `auth.users` | **2** | New-user webhook from GoTrue → server-fn that inserts the profile + first-user-is-admin logic |
| `attachSupabaseAuth` + `requireSupabaseAuth` middleware | **1** | Same Bearer/JWT plumbing; swap `getClaims` for `jose.jwtVerify` |
| Edge-env vars (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) | **1** | Rename → `DATABASE_URL`, `JWT_SECRET`, internal `POSTGREST_URL`. Touch one env-loader file. |
| Cron (8 public hook routes) | **0** | Already plain HTTP + Bearer; trigger from `cron` or `pg_cron` on the new VM |
| **`auth.users` foreign keys** | **0** | Code uses `profiles.id` everywhere — there are **no FKs to `auth.users` from public schema** (verified by table list) |

### A. Current dependency score: **6.5 / 10** (Moderate)
- +2 schema portability, +1 RPC isolation, +1 single-bucket storage, +0.5 single login screen
- −2 Auth deeply integrated (`auth.uid()` in 70 policies + 14 functions)
- −1 6 realtime subscriptions
- −0.5 server-fn middleware reads Supabase JWT claims directly

### B. Estimated migration effort
| Stream | Days |
|---|---|
| Schema migration (`pg_dump`/`pg_restore`, verify all 36 triggers fire) | 1 |
| Postgres-in-Docker + PostgREST + pg_cron setup | 1 |
| GoTrue deploy + Google OAuth + email templates | 2 |
| Replace `handle_new_user` with GoTrue webhook | 0.5 |
| Swap `client.ts` / `client.server.ts` / `auth-middleware.ts` to new env + JWT verify | 1.5 |
| MinIO + rewrite `attachmentsService` and offline-queue uploader | 1.5 |
| Realtime: drop + add `refetchInterval`, OR LISTEN/NOTIFY bridge | 1 – 2 |
| Cron handler env rename + secret rotation | 0.5 |
| End-to-end QA sweep (rerun Phase QA Playwright suite × 3 roles) | 2 |
| Data cutover script (parallel run, dual-write, switchover) | 1.5 |
| Buffer / unknowns | 1.5 |
| **Total** | **12 – 18 days** |

### C. Recommended target architecture

```
                 ┌──────────────────────────────────────────┐
                 │  Single VM  (Docker Compose)             │
                 │                                          │
   Browser ───►  │  caddy/nginx  ──►  app (TanStack Start)  │
                 │                    │                     │
                 │                    ├─► PostgREST  ──►    │
                 │                    │                  │  │
                 │                    ├─► GoTrue ────►   │  │
                 │                    │   (JWT, OAuth)   ▼  │
                 │                    │              postgres:16
                 │                    │              (pg_cron, RLS)
                 │                    └─► MinIO  ◄──┘       │
                 │                                          │
                 │  Volumes:  /var/lib/postgres  /var/minio │
                 └──────────────────────────────────────────┘
```

**Why this shape**
- **PostgREST + GoTrue** are the open-source pieces underneath Supabase. Keeping them means **zero rewrite** for the 150 `.from(...)` calls, the 21 `.rpc(...)` calls, and all 102 RLS policies — `auth.uid()` keeps working unchanged.
- **MinIO** mirrors S3 / Supabase Storage semantics; reuse signed-URL flow.
- **`pg_cron`** replaces the 8 Supabase cron jobs that today hit `/api/public/hooks/*`.
- **App code preserved:** only `src/integrations/supabase/*.ts` (4 files) changes its base URL + JWT secret. The rest of `src/` stays as-is. Optionally rename the import alias `@/integrations/supabase` → `@/integrations/backend` afterwards as a cosmetic pass.
- **Minimal-downtime cutover:** `pg_dump --no-owner --no-acl` from Supabase → restore into the Docker Postgres → freeze writes for ≤10 min → re-restore deltas → switch `VITE_SUPABASE_URL` env → done. Storage objects sync in parallel with `mc mirror`.

**Risks / open questions**
1. Backup & PITR responsibility moves to ops (today: Supabase-managed). Plan = `pgbackrest` to off-VM object storage.
2. GoTrue Google OAuth requires re-issuing client IDs with the new redirect URL — ~30 min coordination.
3. Realtime: if you keep the 6 subscriptions, you own the Elixir Realtime container OR build the LISTEN/NOTIFY bridge — pick one before sprint start.
4. The Lovable Cloud secret format (`sb_secret_*`) is irrelevant after migration; rotate to a 64-char `JWT_SECRET` you control.

---

*End of assessment. No code modified.*

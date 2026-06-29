
# Data Tier Migration — Supabase SDK → Direct PostgreSQL (`pg`)

This is a large, invasive migration. Before I start writing code, I need you to confirm scope and tradeoffs — this affects ~150 call sites across 30+ service modules, 30+ routes, and 14 components, and changes the security model.

## What changes

```text
┌─────────────────────────────┐        ┌─────────────────────────────┐
│ BEFORE                      │        │ AFTER                       │
│                             │        │                             │
│  Browser ─► supabase-js ──► │        │  Browser ─► serverFn ─────► │
│           PostgREST ──► PG  │   →    │           pg.Pool ──► PG    │
│                             │        │                             │
│  Auth: supabase.auth        │        │  Auth: supabase.auth (kept) │
│  RLS:  PostgREST sets JWT   │        │  RLS:  SET LOCAL in tx      │
└─────────────────────────────┘        └─────────────────────────────┘
```

- `supabase.from()`, `.rpc()`, `.select()`, `.insert()`, `.update()`, `.delete()` calls are all replaced with raw SQL via `pg.Pool`.
- Every query becomes server-side. Components import server functions (`useServerFn` + `useQuery`) instead of calling Supabase directly.
- Supabase Auth stays — login, session, JWT verification via `requireSupabaseAuth` middleware is unchanged. The verified `userId` is passed into each query.

## RLS preservation (critical decision point)

Today RLS works because PostgREST sets `request.jwt.claim.sub` per request, and 102 policies + 14 `auth.uid()`-based functions read it. With a raw `pg` pool there is no PostgREST. Two options:

- **Option R1 — Keep RLS, set claims per transaction.** Every server fn runs in a transaction: `BEGIN; SET LOCAL request.jwt.claim.sub = $userId; SET LOCAL role = 'authenticated'; ...queries...; COMMIT;`. Policies and `auth.uid()` continue to work unchanged. Adds 2 round-trips per request but keeps defense-in-depth.
- **Option R2 — Drop RLS, enforce in app.** Connect as superuser, bypass RLS, re-implement every ownership/role check in TypeScript. Faster queries but doubles the security surface; one missed check = data leak.

**I recommend R1.** It preserves the 102 policies you already audited and tested.

## Phased delivery

### Phase 1 — Infrastructure (~0.5 day)
- `bun add pg @types/pg`
- `src/integrations/postgres/client.server.ts` — singleton `pg.Pool` reading `DATABASE_URL` from env.
- `src/integrations/postgres/query.server.ts` — `withUser(userId, fn)` helper that opens a tx, runs `SET LOCAL request.jwt.claim.sub`, executes the callback, commits.
- `src/integrations/postgres/admin.server.ts` — `query()` helper bypassing RLS for cron/webhook handlers (replaces `supabaseAdmin.rpc`).
- New secret: `DATABASE_URL` (Postgres connection string).

### Phase 2 — Service layer rewrite (~3–4 days)
Rewrite each `src/services/*.ts` module. For each, the export surface stays identical (so components keep working) but the body becomes a thin client that calls server functions. The server functions live next to each service as `*.functions.ts` and run raw SQL.

Order (lowest-risk first):
1. Read-only services: `adoption`, `predictions`, `nudges`, `planning-suggestions`, `intelligence`, `executive`, `forecast`, `risks`, `workload`, `exports`, `config-health`, `org-roles`.
2. CRUD services: `tasks`, `comments`, `attachments`, `eod`, `notif-prefs`, `relations`, `work-item-types`, `dynamic-fields`, `workflow`, `approvals`, `automations`, `carry-forward`, `templates`, `config-snapshots`, `config-io`, `onboarding`, `operations`.
3. RPC-heavy services: `install_template`, `snapshot_config`, `restore_config`, `detect_risks`, `generate_nudges`, `adoption_rollup`, `predict_tomorrow_risks`, `generate_planning_suggestions`, `runAutomationTick`, all approval engine RPCs.

### Phase 3 — Route loaders and cron handlers (~1 day)
- 5 `api/public/hooks/*.ts` cron routes — swap `supabaseAdmin.rpc(...)` for `adminQuery('SELECT ... FROM rpc_name(...)')`.
- `src/routes/index.tsx`, `_authenticated.tsx`, `login.tsx` — keep `supabase.auth.*` but replace `supabase.from('user_roles')` with a server fn.
- `useRealtimeTasks` hook — Postgres LISTEN/NOTIFY isn't exposed to browsers without a websocket layer. Recommend dropping realtime and relying on existing `refetchInterval: 30_000`. Confirm before I delete the hook.

### Phase 4 — Verification (~0.5 day)
- `tsgo` clean.
- `bunx vitest run` — update `tests/mocks/supabase.ts` to also mock the pg pool.
- Playwright smoke: login → My Day → create task → comment → EOD → manager dashboard.

## Things I need you to confirm

1. **RLS strategy** — R1 (keep RLS via `SET LOCAL`) or R2 (drop RLS, app-level checks)? Default: R1.
2. **`DATABASE_URL`** — once you confirm, I'll request it via `add_secret`. It must be the Postgres connection string for your self-hosted instance (the one stood up by `infra/docker-compose.yml`). Until then, server fns will fail at runtime but the build will pass.
3. **Realtime hook** — drop `useRealtimeTasks` and rely on 30s polling, or build a SSE shim? Default: drop.
4. **Cutover style** — do you want a feature flag (`DATA_TIER=supabase|postgres`) so the swap is reversible per-deploy, or a hard cutover (delete Supabase data calls in the same PR)? Default: hard cutover, since reversibility doubles the code surface.

## Out of scope
- Data migration itself (already covered by `infra/scripts/cutover.sh`).
- Replacing Supabase Auth.
- Replacing Supabase Storage (still served via the existing client).
- Realtime websocket replacement.

## Effort & risk
- **~5–6 working days** of focused refactor.
- **High risk** of regressions in approval engine, automation worker, and executive dashboard — these have the densest SQL. Mitigation: rewrite each in parallel with its existing vitest suite.

Reply with answers to the 4 questions above and I'll start at Phase 1.

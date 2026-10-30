# Daily Flow / Operon — Network Traffic Audit

Audit date: 2026-10-30 · Branch audited: `feat/web-socket-io` @ `56b3349` · Mode: read-only (no code, config, container or DB changes; no secrets read or printed)

---

## 0. Read this first — what this audit can and cannot prove

| Limit | Consequence |
|---|---|
| **I have no access to the production host or database.** `docker ps` on this machine lists no containers, and I did not connect to any DB. | Every traffic number below is derived from your counters plus source code. Nothing here is a measurement of production. |
| **Your counters (800 MB, 787 MB, 740 MB, 878 MB…) are cumulative, and you did not give the window.** | I cannot compute "MB per user per day" without the container uptime (or counter start time). I give the formula and a scenario table instead of inventing a number. |
| **The repo HEAD is not necessarily what production runs.** 9 performance commits landed on 2026-10-28/29 (`5118d09` … `56b3349`). `master` is at `306c12a` (2026-10-15) and has no Socket.IO at all. | Several root causes below are **confirmed in git history** but **unconfirmed as live in production**. Step 0 in §8 settles this in two read-only commands. |

Labels used throughout:

- **CONFIRMED** — directly visible in code/config, with file and line.
- **INFERRED** — follows from confirmed facts plus arithmetic on your counters. The assumption is stated.
- **POTENTIAL** — plausible from code, needs a measurement to promote or discard.

---

## 1. Executive summary

1. **The traffic is almost entirely request-driven JSON, not background chatter.** Background services (change watcher, cron ticker, Socket.IO keep-alives) are estimated at roughly **0.15–0.2 MiB/min combined** (INFERRED, §5). Your measured app inbound was **1.59 MiB/min**, so at least ~90% of it came from something else: browsers and server functions pulling data.

2. **Your counters pin the heavy path.** `Caddyfile` proxies only the API, auth and files domains. The app on port 7050 is published directly and bypasses Caddy (`infra/docker-compose.yml:84-85`, `infra/Caddyfile:1-14`). So Caddy's ~740 MB is almost all browser→PostgREST REST traffic, and PostgREST's ~780 MB matches it. The algebra in §4 shows ≥90% of that is **response bodies** (JSON rows), not request overhead or SQL text. **INFERRED, strongly.**

3. **API responses are not compressed.** The Caddyfile has no `encode` directive (CONFIRMED, `infra/Caddyfile`), and PostgREST v12 does not compress. Repetitive JSON of task rows typically shrinks 85–95% with gzip/zstd. This is the single largest, lowest-risk lever regardless of anything else.

4. **Root cause of the *volume*, per git history, is full-table reads re-fired by realtime fan-out.** Before commits `5118d09`/`79b0de9`/`058183a`, Tasks, Team Capacity, Executive, EOD, Capacity, Command, Dashboard, Workload, Planning and Time Tracking downloaded **entire** `tasks` and `task_worklogs` tables on every refresh. The team's own comment records a full `select=*` as **~1.2 MB for ~1,200 tasks** (`src/lib/task-columns.ts:1-4`). And every task change is signalled to **all 10 users** (`entity-watcher.server.ts:49`, `ALL_USERS_ROOM = "authenticated"` at `entity-events.server.ts:24`), so one task edit triggered ~10 clients × several full-table refetches. **The fix is already committed on this branch. Whether it is deployed is unknown.**

5. **One real, always-on background cost exists and is independent of users:** the entity change watcher runs 10 SQL statements every 3 seconds forever (`entity-watcher.server.ts:44-137, 180, 188`). It is cheap per call but it is ~288,000 queries/day, and the DB triggers that would make it stand down are **not defined anywhere in the repo** (CONFIRMED by grep: `trg_realtime_*` appears only as names the watcher looks for).

6. **Things that are NOT the cause** (CONFIRMED): Keycloak token refresh (12 h token, the 60 s timer makes no network call unless the token is within 70 s of expiry), the 1 s UI timers (local only), Socket.IO keep-alives (tiny), the 60 s cron ticker (~3 small queries/min).

**Bottom line:** with only 10 users the volume is an *amplification* problem (full-table payloads × fan-out to every user × no compression), not a *user-count* problem. Per-user numbers look absurd because each user's browser is re-downloading data other users changed.

---

## 2. Answers to your questions

| Question | Answer | Status |
|---|---|---|
| Why is traffic so high with 10 users? | Whole-table JSON payloads (~1 KB/row), refetched by every client on every task change by anyone, uncompressed. | Payload size/fan-out CONFIRMED in code; that it is what's live is INFERRED (see §0) |
| Traffic per user? | Cannot be computed without counter window. Formula in §6. | — |
| Does every logged-in user continuously generate background API requests? | **At HEAD: no.** There is no `refetchInterval` anywhere in `src` (CONFIRMED by grep). The only continuous per-user traffic is the Socket.IO ping (≈2 tiny frames per 25 s). **In older builds: yes** — `refetchInterval: 5000` on My Day, Manager and Executive (commit `65c1b1b`, 2026-07-28, removed in `fd13958`, 2026-10-15), and a fake channel that fired every subscriber every 4 s (per the header comment of `src/integrations/realtime/channel.ts:2-3`). | CONFIRMED (code/history); which build is live: UNKNOWN |
| Does traffic continue when users close their browsers? | **Yes, but small.** Browser-originated traffic stops completely. Server-originated traffic continues: watcher (every 3 s), cron ticker (every 60 s), the Postgres `LISTEN` connection, container healthchecks. | CONFIRMED that they run; size INFERRED |
| Traffic split: React polling / Socket.IO / notifications / cron / services | See §5: React polling ≈ 0 at HEAD; Socket.IO ≈ <0.01 MiB/min; notifications = on-event only; cron ≈ <0.01 MiB/min; watcher ≈ 0.14–0.2 MiB/min; the rest is request-driven reads. | Mixed; per-row labels in §5 |
| Which endpoints/queries transfer the most? | Ranked by code in §7. Measured ranking needs `pg_stat_user_tables` deltas (Step 0). | POTENTIAL until measured |
| Is the same data fetched repeatedly? | Yes: (a) full-table refetch on every realtime event for all users, (b) several pages each load their own copy of tasks, (c) `select("*")` on `tasks` in a few components. Mostly fixed at HEAD. | CONFIRMED in history |
| Actual daily usage per user? | See §6 — needs your uptime. | — |

---

## 3. Architecture and traffic topology (CONFIRMED)

```
Browser ──HTTP/WS──► app:7050 (Node: SSR, /_serverFn, /socket.io)        ← NOT behind Caddy
Browser ──HTTP────► Caddy ─► postgrest:3000 ─► postgres:5432            ← all supabase.from(...) reads/writes
Browser ──HTTP────► Caddy ─► keycloak:8080  ─► postgres (keycloak schema)
app ─► postgres (pg Pool: watcher, cron, listener, server fns using pool)
app ─► PostgREST via SUPABASE_URL (supabaseAdmin / context.supabase in server functions)  ← route unknown, see below
```

- `infra/docker-compose.yml:84-85` publishes the app on `7050`; `infra/Caddyfile` has three site blocks (API→postgrest, AUTH→keycloak, FILES→minio) and **no site for the app**. `runner.js` serves static files and SSR itself.
- Postgres is published on host port `7055` (`docker-compose.yml:23-24`). Not a traffic cause, but note it for the security review.
- `SUPABASE_URL` for the app container is read from `.env` (not shown, deliberately). If it points at the public API domain, server-function reads (`getMyDay`, `getManagerCommand`, `getExecSummary`) go **app → Caddy → PostgREST** and are counted in *both* Caddy and app inbound. That would explain why app inbound (1.59 MiB/min) is 7× app outbound (0.23 MiB/min): the app downloads big JSON and returns small aggregates. **POTENTIAL; check with Step 0.**

---

## 4. Inbound/outbound analysis (INFERRED from your counters)

Notation: for a pass-through proxy, `in = out = request bytes + response bytes`.

**Caddy:** in 740 / out 741 → proxied volume `a + b ≈ 740 MB` (a = request bytes, b = response bytes). Symmetry is exactly what a proxy produces, so it tells us nothing about *which* direction dominates by itself.

**PostgREST:** in 787 = `a + P_res`; out 777 = `b + P_req`, where `P_res`/`P_req` are the Postgres-side result/request bytes. PostgREST builds the whole JSON body inside Postgres (`json_agg`), so `P_res ≈ b`. Then:
`a + b ≈ 740` and `a + P_res ≈ 787` → `P_res − b ≈ 47 MB`, i.e. the SQL request text plus protocol overhead (`P_req`) is only **~40–50 MB (~5%)**. The remaining ~95% is JSON response payload.

**PostgreSQL:** out 878 MB ≈ `P_res (~700–740, to PostgREST)` + `~140 MB` to everything else (app pool: watcher, cron, server functions via pool; Keycloak).

**Conclusions (INFERRED):**
- ~85% of all DB egress is PostgREST JSON payloads that then cross Caddy to browsers (or to the app, see §3).
- Request/SQL overhead is negligible; the problem is **bytes per response × number of responses**, not number of tiny calls.
- The app's own pool traffic (watcher etc.) is ≤ ~15% of Postgres egress.
- App inbound 800 MB cannot be explained by the 140 MB of pool results alone; the rest is HTTP inbound to the app (uploads, server-function request bodies) and/or PostgREST responses fetched via `SUPABASE_URL`. **Unresolved** — Step 0 item 2 resolves the second half.

---

## 5. Background services, Socket.IO and cron

### 5.1 Entity change watcher — the only always-on poller (CONFIRMED running; cost INFERRED)

| Fact | Where |
|---|---|
| Started on every server boot | `src/server.ts:19` |
| Interval default 3000 ms (`OPERON_CHANGE_WATCH_MS`) | `src/lib/entity-watcher.server.ts:180, 188, 321-322` |
| 10 specs → 10 `SELECT … GROUP BY` statements per tick: `tasks`, `nudges`, `risk_events`, `planning_suggestions`, `approval_requests`, `task_review_decisions`, `task_worklogs`, `leaves`, `eod_checkins`, `automation_health` | `entity-watcher.server.ts:44-137` |
| Stands down per table only if a DB trigger named `trg_realtime_<table>` exists (checked every 60 s) | `entity-watcher.server.ts:51,59,66,74,215-236` |
| **No SQL file in the repo creates those triggers** (grep over `*.sql`, `*.md`, `*.ts`). Only 4 of 10 specs even *have* a stand-down name. | grep, 2026-10-30 |
| Every non-GET request the Node server handles also "pokes" it (extra immediate tick, min 150 ms gap) | `src/server.ts:101`, `entity-watcher.server.ts:200-208` |
| Clients also poke after writes (≤ 1 per 300 ms per client) | `src/integrations/realtime/socket.ts:318-341` |

**Estimated cost (assumes ~10 assignees/users, ~60–130 bytes per result row, ~300 B SQL text per statement):**

| | per tick | per day | per min |
|---|---|---|---|
| Queries | 10 | ~288,000 (+1,440 trigger checks) | 200 |
| App → Postgres | ~3–4 KB | ~86–115 MiB | ~0.06–0.08 MiB |
| Postgres → App | ~4–6 KB | ~115–170 MiB | ~0.08–0.12 MiB |

That is **~25–35% of your measured app outbound (0.23 MiB/min) but only ~5–8% of measured app inbound (1.59 MiB/min)**. It runs 24/7 including nights and weekends, with zero users. Pokes add on top during activity (up to ~6 ticks/s worst case = 67 queries/s if writes are continuous; realistic far less).

Secondary effect (CONFIRMED): each `tasks` change emits to **all** users (`rooms: () => [ALL_USERS_ROOM]`, line 49), and the event carries only routing ids, so every client then refetches over REST. The small websocket event is cheap; the *refetch it triggers* is the real cost (§7, F1).

### 5.2 Socket.IO (CONFIRMED config; cost INFERRED negligible)

- Client: `io({ path: "/socket.io", reconnection: true, … })` with **no `transports` option** → defaults to HTTP long-polling handshake, then upgrades to WebSocket (`socket.ts:194-200`). Server: defaults too (`realtime.server.ts:160-166`), reachable directly on 7050 with no proxy in front, so the upgrade should succeed. *Not verified in production.*
- Steady state: Socket.IO default ping every 25 s per socket → 10 sockets ≈ 0.4 frames/s total ≈ **<0.01 MiB/min**.
- Per connect: ~3–4 HTTP requests for the handshake + 1 DB query (`loadRoleRooms`, `realtime.server.ts:185`) + JWKS verify (cached by `jose`, `jwt.server.ts:15-24`). Cheap unless sockets flap.
- **Recovery behaviour that can cause bursts (CONFIRMED):** every server restart changes `boot` id, and `buildResync` answers `full: true` (`realtime.server.ts:82-84`), so **every connected tab refetches everything** once. A tab hidden ≥5 s asks for a resync on return (`socket.ts:45,254`) and refetches only the tables that changed for it. If the app container restarts often (deploys, crashes), expect a repeated synchronized full refetch by all users.
- While disconnected, a single backed-off safety refresh (60 s, 2 m, 4 m, then 5 m) fires (`socket.ts:43,68-88`). No polling when connected. Verified by tests `tests/hooks/use-realtime-refresh.test.tsx:108`, `tests/realtime/notifications-provider.test.tsx:252`.

### 5.3 Cron ticker (CONFIRMED; negligible)

`src/lib/cron-ticker.server.ts:46,381` runs every 60 s: `promoteDueTentativeLeaves` (1 `UPDATE`), `checkIsWorkingDayServer` (`work_settings` via PostgREST + `holidays` via pool), then `work_settings` again (`:69-73`). ≈3 round trips/min, a few KB. It exits early on weekends/holidays. Event steps fire once/day: morning digest, evening notifications, and the manager EOD report which reads **all tasks** (`:184-190`, no window) once/day (~0.5 MB at 1,200 tasks). `workload-snapshot` hook also reads `tasks.select("*")` once nightly (`src/routes/api/public/hooks/workload-snapshot.ts:19`). Total cron ≈ **<10 MB/day**.

### 5.4 Notifications (CONFIRMED; negligible at HEAD)

Delivered by `notification:new` push (`use-notifications.tsx:234-241`), not polling. List is paged at 50; refetch uses a ~75 B/row id+read-state index and downloads full rows only for unseen ids (`:126-165`). Older builds fetched the full list. The server `LISTEN` connection (`notification-listener.server.ts`) is idle between events.

### 5.5 Not sources (CONFIRMED)

- Keycloak refresh timer `src/integrations/backend/auth.ts:107-120` (60 s) calls `updateToken(70)`; `accessTokenLifespan` is 43200 s (`infra/keycloak-realm.json:10`), so it hits the network about once per 12 h.
- `TaskHoursBadges.tsx:47`, `TaskDetailModal.tsx:175`, `use-minute-tick.ts:8` are local re-render timers.
- Service worker no longer intercepts `/socket.io` or double-fetches `/_serverFn` (`public/sw.js`, cache v3).

---

## 6. Per-user and daily usage

Use your real window `N` (days since counters reset / container start):

```
per-user per-day (API path) ≈ 740 MB / 10 users / N
```

| N (days) | API path per user per day | Whole-system DB egress per user per day (878 MB) |
|---|---|---|
| 1 | ~74 MB | ~88 MB |
| 3 | ~25 MB | ~29 MB |
| 7 | ~11 MB | ~13 MB |
| 30 | ~2.5 MB | ~2.9 MB |

Caveats: counters also include admin/dev activity, deploy-time full refetches, and weekends with near-zero use, so a *working-day* figure is higher than the divided average. Managers (3) cost more than members (7): manager pages read larger scopes.

For comparison, the app's own 60-second sample (1.59 MiB in + 0.23 MiB out ≈ 1.82 MiB/min) would be ≈ 2.6 GB/day if sustained 24 h, which it is not; it reflects a busy minute.

---

## 7. Root causes, ranked, with exact code

### F1 — Whole-table reads re-fired by all-user fan-out · CONFIRMED in history · live status UNKNOWN
- **Before** `5118d09` / `058183a`: pages loaded all tasks and all worklogs per refresh. Commit message: *"instead of downloading every task and every worklog on each refresh"*. `src/lib/task-columns.ts:1-4`: *"`select=*` on ~1,200 tasks is ~1.2 MB"*.
- Fan-out: `entity-watcher.server.ts:49` (tasks → everyone), `:101` (worklogs → everyone), `:110` (leaves → everyone). Client throttle is leading+trailing 250 ms (`channel.ts:51,100-114`), so a burst of N edits yields about 2 refetches per subscriber, per client.
- Rough model (illustrative, stated assumption: 5 subscribed task queries × 1.2 MB, 40 task changes/day): 40 × 10 clients × 6 MB = **2.4 GB/day**. Order of magnitude matches your counters, which is why I rank this first. It is a model, not a measurement.
- **At HEAD:** windowed (open + completed last 14 days), column-trimmed lists, server-side pagination on Tasks, changed-rows delta refresh. Worklogs embedded with 7 columns (`task-window.ts:44`).

### F2 — No response compression on the API path · CONFIRMED
- `infra/Caddyfile:1-4`: `reverse_proxy postgrest:3000` with no `encode`. PostgREST does not compress.
- App-side: `runner.js` (commit `1bbe6d2`) compresses static assets (br/gzip, cached). Its header comment says dynamic responses are streamed compressed; I did not verify that path.
- Effect: every JSON byte in §4 crosses the network at full size.

### F3 — Always-on 3-second watcher, 10 queries/tick · CONFIRMED · see §5.1
Fix is configuration-level in the DB (install the push triggers) or interval-level (`OPERON_CHANGE_WATCH_MS`), both require your approval.

### F4 — Manager server functions read whole scopes on every task event · POTENTIAL
- `getManagerCommand` (`src/lib/manager.functions.ts:123,185-190`) selects 15 columns for **all** tasks of the scoped members, plus 5 more tables, every call. Same family: `getExecSummary` (`src/lib/executive.functions.ts:13`).
- It is invalidated by task events (comments in `executive.tsx:304`, `manager.tsx:23-25`), so with 3 managers each task change re-runs it 3×. Commit `058183a` windows several of these; I did not re-verify each.
- If `SUPABASE_URL` is the public API domain, this traffic traverses Caddy twice in effect (app inbound). Step 0 item 2.
- `getExecSummary` is `POST`, so each call also **pokes** the watcher (`server.ts:101`). 130 of 181 server functions are non-GET (51 explicit `GET`), so reads written as POST each trigger an extra 10-query check.

### F5 — `select("*")` on `tasks` in UI paths · POTENTIAL (each is bounded, none is per-minute)
| Location | Behavior |
|---|---|
| `src/components/GlobalSearchModal.tsx:74-83` | On every open with empty query: 100 full task rows + all profiles. |
| `GlobalSearchModal.tsx:111-125` | Per debounced keystroke: up to 150 full rows. |
| `src/components/MyTodayWorkSummaryCard.tsx:80` | All of a user's tasks (all history) once per My Day mount, if `allTasks` isn't passed (`my-day.tsx:685` does pass `tasks`, so this may be dead code). |
| `src/services/tasks.ts:225, 240` | `getActiveTask`, `queryTasks` full rows. |
| `src/routes/_authenticated/blockers.tsx:20` | All blocked tasks, full rows. |
| `src/routes/_authenticated/calendar.tsx:303,425`, `eod.tsx:160`, `executive.tsx:235`, `exports.tsx:1144,2020` | `select("*")` on larger tables; check which table each targets. |

### F6 — Restart ⇒ synchronized full refetch by all clients · CONFIRMED mechanism, frequency UNKNOWN
`realtime.server.ts:82-84`. Check `docker inspect` restart count and deploy cadence.

### F7 — Full-tab visibility resyncs · LOW
`socket.ts:243-255`. Targeted to changed tables only, so cheap unless F1 payloads are still live.

### Dismissed (CONFIRMED not material)
Socket.IO heartbeat, Keycloak interval, UI timers, service-worker duplication (fixed in `5118d09`), cron ticker, notification list (fixed in `0d2043e`).

---

## 8. Step 0 — verify before fixing (all read-only; run on the production host)

These turn "INFERRED/POTENTIAL" into facts. None changes anything. None prints secrets.

1. **Is the optimized code live?**
   `docker image inspect <app-image> --format '{{.Created}}'` — compare with the commit dates (5118d09 = 2026-10-28, 058183a = 2026-10-29). If the image is older, F1 is live and deploying the already-committed branch is the biggest win.
2. **Does the app reach PostgREST through Caddy?**
   `docker exec <app> printenv SUPABASE_URL` (this variable only; contains no key). A public domain ⇒ hairpin through Caddy; `http://postgrest:3000` ⇒ internal.
3. **Are push triggers installed?**
   `SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_realtime%' AND NOT tgisinternal;` (empty ⇒ watcher polls all 10 specs).
4. **Which tables actually get read the most?** `pg_stat_statements` is **not** available (compose preloads only `pg_cron`, `docker-compose.yml:16`). Use deltas instead, one minute apart during working hours and again at night:
   `SELECT relname, seq_tup_read, idx_tup_fetch, n_tup_ins, n_tup_upd FROM pg_stat_user_tables ORDER BY seq_tup_read+idx_tup_fetch DESC LIMIT 15;`
   Night delta = background floor (watcher). Day delta minus night = user-driven.
5. **Background floor in bytes:** at ~02:00 IST, `docker stats --no-stream` twice, 60 s apart, for app/postgres. That gives MiB/min with no users — directly tests §5.1's estimate.
6. **Restart frequency:** `docker inspect --format '{{.RestartCount}} {{.State.StartedAt}}' <app>`.
7. **Socket transport:** browser DevTools → Network → WS filter on `/socket.io`: one 101-upgrade socket per tab means healthy. Repeating `transport=polling` requests mean the upgrade is failing (that would be a real polling storm and is not visible in the code).

Caddy cannot attribute bytes per endpoint today: there is **no `log` directive** in the Caddyfile. Per-endpoint measurement requires enabling access logs (a config change, so it needs your approval).

---

## 9. Optimization recommendations (ranked) — nothing below has been implemented

| # | Action | Needs | Risk | Addresses |
|---|---|---|---|---|
| 1 | **Run Step 0 items 1–3**, then deploy the already-committed optimizations if the live image predates them. | Your approval to deploy | Low (tests exist; includes RLS v2 `caed6cd`, review its migration separately) | F1, F2(partly), F4 |
| 2 | **Enable compression on the API path:** `encode zstd gzip` in the API site block of `infra/Caddyfile`. | Caddy config change + reload | Very low | F2 |
| 3 | **Install the realtime push triggers** (`trg_realtime_*`) so the watcher stands down; extend stand-down coverage to the 6 specs that have none. | DB migration (you approve SQL) | Medium; test on a copy | F3 |
| 4 | Until #3: raise `OPERON_CHANGE_WATCH_MS` from 3000 to 10000–15000 (still poked instantly by app writes). | Env change + restart | Low; latency for out-of-band writers rises | F3 |
| 5 | Make read-only POST server functions `GET`, or stop poking the watcher for them. | Code change | Low | F4 |
| 6 | Scope realtime fan-out: members should not refetch on every other member's task change. Emit to `user:<assignee>` + `role:manager` instead of the all-users room. | Code change; verify RLS parity | Medium | F1 |
| 7 | Window or server-side aggregate `getManagerCommand` / `getExecSummary`; project only needed columns. | Code change | Medium | F4 |
| 8 | Replace remaining `select("*")` on tasks (F5 list) with column lists from `task-columns.ts`. | Code change | Low | F5 |
| 9 | Enable Caddy access logs (size-bounded) and expose `docker stats` to a dashboard so the next audit measures instead of infers. | Config change | Very low | measurability |
| 10 | Stop publishing Postgres on host `7055` unless needed. | Compose change | Low (security, not traffic) | — |

### Expected improvements (ESTIMATES — to be re-measured after each step)

| After | Expected effect |
|---|---|
| #2 compression | ~85–95% less API bytes on the wire for JSON (typical gzip ratio on row-oriented JSON). Biggest single win if #1 is already live. |
| #1 deploy (if stale) | Orders-of-magnitude cut on page loads/refetches (windowed + column-trimmed + deltas). The commits' own docs claim full-table reads shrink to a fraction; I did not benchmark. |
| #3/#4 watcher | Removes ~0.14–0.2 MiB/min (~200–290 MiB/day) and ~288k queries/day of constant load; also removes the night/weekend floor. |
| #6 scoped fan-out | Members' refetches fall roughly with the share of task changes that are not theirs (up to ~70–90% fewer refetches for the 7 members). |
| Combined #1+#2+#3 | A realistic target is 90%+ less total transfer than the figures you reported. Confirm with Step 0 #5 and a before/after `docker stats` over a work day. |

---

## 10. Open items I could not resolve without production access

- Counter window (needed for per-user daily numbers).
- Which image/commit is running.
- Value of `SUPABASE_URL` in the app container.
- Whether `trg_realtime_*` triggers exist in the live DB.
- Whether Socket.IO is on WebSocket or stuck on long-polling in real browsers.
- Per-endpoint byte ranking (needs Caddy logs or table-stat deltas).

*No fixes will be applied until you approve this report.*

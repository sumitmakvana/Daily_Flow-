# Daily Flow / Operon — Network Audit, Part 2 (post-optimization)

Date: 2026-10-30 · Code: `feat/web-socket-io` @ `56b3349` (stated by you to be what production runs) · Read-only: no code, config, container or DB changes, no secrets read.
Compares against: `DAILY_FLOW_NETWORK_AUDIT.md` (Part 1).

## 0. Limits (unchanged, and they matter)

- **I still have no production access.** No metric below was measured on production. Labels: **CONFIRMED** = visible in code with file:line; **INFERRED** = follows from confirmed code plus your counters; **POTENTIAL** = needs one measurement.
- Part 1's top cause (whole-table reads re-fired by fan-out) is **withdrawn as the current cause**, because you confirm the optimized build is live. That finding stays valid only for the *history*.
- So what is still big? Part 1 stopped at the REST/task paths. This pass looked at everything else that moves bytes. It found **two payload classes Part 1 never looked at: file binaries stored inside PostgreSQL, and notebook notes with embedded images.** Neither is polling; both are exactly the shape of traffic that survives a "stop refetching tasks" optimization.

## 1. Executive summary

| # | Finding | Status | Likely weight |
|---|---|---|---|
| 1 | **API responses still uncompressed** (no `encode` in Caddy) | CONFIRMED | Multiplies everything on the REST path |
| 2 | **Attachment binaries live in Postgres (`file_data bytea`) and three client queries use `select("*")` on that table through PostgREST**, so the whole file is returned hex-encoded inside JSON | CONFIRMED in code; frequency POTENTIAL | Potentially the largest single payload per request |
| 3 | **Every file view re-downloads the file**: the signed URL changes on every call, so the browser cache (`max-age=3600`) never hits; each download reads the whole `bytea` from Postgres through the app | CONFIRMED | Repeats #2-class bytes on every preview |
| 4 | **Uploads are raw (≤20 MB), go through the app into Postgres**, and run an `ALTER TABLE` on every upload | CONFIRMED | App *inbound*-heavy, which is the shape you measured (in 1.59 vs out 0.23 MiB/min) |
| 5 | **Notebook notes load in full on every page load for every user** (mounted in the app shell), with images as base64 inside the note, unbounded, and the whole note is re-saved on every debounced edit | CONFIRMED code; size POTENTIAL | Heavy only if users paste images |
| 6 | **Entity watcher** still polls 10 queries every 3 s, 24/7 (no push triggers in repo) | CONFIRMED | A fixed floor, ≈0.14–0.2 MiB/min estimated; not the main bulk |
| 7 | Remaining unscoped task subscribers: 10 pages still refetch on **any** user's task change | CONFIRMED | Now bounded by delta loading; moderate |
| 8 | Socket.IO, polling timers, cron ticker, Keycloak refresh | CONFIRMED not material | ≈0 |

**Why traffic is "still high" in one sentence:** the optimization removed task-table re-downloads, but the remaining bytes are (a) uncompressed JSON, (b) binary file and note-image payloads that are large per request and are re-fetched rather than cached, plus (c) a constant 3-second database poll. None of those scales with "10 users", they scale with *how big each payload is*.

## 2. What the counters say, and why they fit (INFERRED)

- App inbound (1.59 MiB/min) is **7× app outbound** (0.23 MiB/min). A page that is mostly *serving* data to browsers would show the opposite ratio. So during your 60-second sample the app was mostly **receiving**. Three things do that:
  1. **Uploads** (`/app-storage/upload`, up to 20 MB, entering the app as multipart) — finding 4.
  2. **Server-function reads that pull big JSON from PostgREST/Postgres and return small aggregates** (`getMyDay`, `getManagerCommand`, `getExecSummary`) — only counted as app inbound if `SUPABASE_URL` is routed through Caddy, otherwise only if they go over the pool. Part 1 Step 0 item 2 settles it.
  3. **The watcher's result sets** — small (≈0.08–0.12 MiB/min est.).
- File *downloads* and notebook *list reads* would push bytes **outbound** from the app as well, so they do not explain a 7:1 inbound ratio in that particular minute. They are still real costs over the whole counter window (rows 2, 3, 5 above), which is why the cumulative PostgREST/Caddy/Postgres totals are high.
- Part 1's algebra still holds: ≈95% of PostgREST traffic is response payload, ≈5% SQL/request overhead. That points at **response size** (findings 1, 2), not request count.

## 3. Confirmed findings with evidence

### F1 — No compression on the REST API · CONFIRMED (unchanged from Part 1)
`infra/Caddyfile:1-4` `reverse_proxy postgrest:3000`, no `encode`. PostgREST does not compress. Bytea hex (F2) is highly compressible too.

### F2 — `select("*")` pulls file binaries through PostgREST · CONFIRMED code
- The attachments table gets a `file_data bytea` column at upload time: `src/routes/app-storage/upload.ts:29` (`ALTER TABLE public.attachments ADD COLUMN IF NOT EXISTS file_data bytea`), and the insert stores the whole file at `upload.ts:32-45`. The authenticated role has table-level `SELECT` (`supabase/migrations/20260616051531_…sql:13`), which covers that column.
- Client queries that read the whole row (including `file_data`) through PostgREST:
  - `src/components/TaskHistorySheet.tsx:62` — newest `limit` (page size) attachments of a task, `select("*")`.
  - `src/components/fields/PhotoField.tsx:39` — one row per photo field, to get a download URL it only needs `storage_path` for.
  - `src/components/fields/SignatureField.tsx:26` — same.
- PostgREST renders `bytea` as a `\x…` hex string in JSON, i.e. **~2× the file size**, before any HTTP compression (none, see F1).
- The safe pattern already exists: `listAttachmentsFn` selects only 8 metadata columns (`src/services/attachments.functions.ts:21-22`).
- Weight depends on how many attachments exist and how often those components mount. **POTENTIAL until measured** (query in §6).

### F3 — Signed URLs defeat caching; every view re-reads the whole file from Postgres · CONFIRMED code
- `src/integrations/backend/storage.ts:27-35`: the URL embeds `expires = Date.now() + …` and an HMAC of it, so **every call produces a different URL**.
- `src/routes/app-storage/file.ts:42-47, 67`: serves with `Cache-Control: private, max-age=3600`. A cache keyed by URL can never reuse it, because the URL differs every time.
- Each hit does `SELECT file_data … WHERE storage_path = $1` (whole file from Postgres → app → browser). Postgres egress + app inbound + app outbound for every preview, every mount of `PhotoField`/`SignatureField` (`PhotoField.tsx:33-48`), every open of an attachment (`TaskDetailModal.tsx:834`, `AttachmentsPanel.tsx:72`).

### F4 — Uploads are raw, large and DDL-heavy · CONFIRMED code
- Limit is 20 MB per file (`src/services/attachments.ts:19,43`; `TaskFormDialog.tsx:247`). Only photo-capture fields compress (`image-compress.ts`, 1600 px / q 0.78, used by `PhotoField.tsx`); `AttachmentsPanel` and the task form upload files as picked.
- Path: browser → app (`upload.ts:12,24` `request.formData()`, `arrayBuffer()`) → Postgres (`bytea`). One upload = full file as **app inbound**, then again app→Postgres.
- `upload.ts:29` issues `ALTER TABLE … ADD COLUMN IF NOT EXISTS` **on every upload** (a catalog-lock DDL each time, unlike the memoized `ensure*Table` helpers elsewhere).
- Each POST also pokes the entity watcher (`src/server.ts:101`).

### F5 — Notebook notes: full load on every page load, base64 images, whole-note saves · CONFIRMED code
- `DockNotepadBar` is mounted in the shell (`src/components/AppShell.tsx:783`) and calls `useNotes()` (`DockNotepadBar.tsx:12`), which loads notes on mount (`notesStore.ts:195-201`, `loadNotes`).
- `listNotebookNotesFn` (`src/services/notebook.functions.ts:64-91`) returns **every note** of the user with `content` and `images`, no limit, no column trimming.
- Images are added via `FileReader` as base64 data URLs with no resize/compress (`src/components/notebook/RichNoteEditor.tsx:171-178`, and pasted images inline as `<img src="data:…">` in `content`, `:155, :178`). They are stored in `content`/`images jsonb`.
- Every edit schedules a save 700 ms after the last keystroke (`notesStore.ts:12, 35-69`); `notebookService.save(note)` sends the **whole note including all images** (`notebook.functions.ts:93+`). That is app inbound and Postgres write traffic per editing burst.
- If no one pastes images these notes are tiny and this is negligible. **POTENTIAL until sizes are measured** (§6).

### F6 — Entity watcher floor · CONFIRMED (unchanged from Part 1 §5.1)
`src/lib/entity-watcher.server.ts:44-137, 180, 188`; started at `src/server.ts:19`; no `trg_realtime_*` creation SQL anywhere in the repo (only lookups at `:51,59,66,74`). Always on, independent of users and browsers. Estimated 0.14–0.2 MiB/min (assumes ~10 groups, 60–130 B/row). Part 1 already showed this is at most ~5–8% of measured app inbound, so it is **a constant tax, not the explanation for the volume**.

### F7 — Unscoped task subscribers still fire on anyone's change · CONFIRMED code, now bounded
- The server tells **all** users about every task change (`entity-watcher.server.ts:49`, `ALL_USERS_ROOM`, `entity-events.server.ts:24`).
- `useRealtimeTasks` defaults to scope `all` (`src/hooks/use-realtime-tasks.ts:15-19`). Pages still using it unscoped: `blockers.tsx:28`, `calendar.tsx:157`, `command.tsx:51`, `eod-tasks.tsx:81`, `eod.tsx:131`, `planning.tsx:44`, `reviews.tsx:60`, `settings.operations.tsx:171`, `tasks.tsx:414`, `workload.tsx:31`. (My Day correctly scopes to the assignee: `my-day.tsx:300-304`.)
- Per event each open page refetches. Refetches are now delta-based, but `loadAllTasksSlim` does a **full light read every 5 minutes** when an event arrives after that gap (`src/lib/task-window.ts:296-305`), so an open Workload/Command/EOD tab does a full slim read of all tasks at most once per 5 min *if* events keep coming. `blockers.tsx:20` still reads full rows of all blocked tasks, `dashboard.tsx:46` uses its own unscoped channel.
- Weight: moderate; scales with (open manager tabs × task events).

### F8 — Scheduled hooks · CONFIRMED code, schedule UNKNOWN in production
- `automation-tick` is designed to run **every 30 s** (`src/routes/api/public/hooks/automation-tick.ts:7`; `PHASE_D_AUTOMATION_DESIGN.md:116,359`). Each tick makes ~6+ PostgREST/RPC calls (`worker.server.ts:67,114-118,153-192`, includes `approval_outbox_events.select("*").limit(200)` at `:114-118`), and being a POST it also pokes the watcher. With empty queues this is a few KB per tick (~10 MB/day). Whether pg_cron actually runs it in production is unknown.
- `no-tasks-reminder` (intended every 20 min) and daily hooks (`carry-forward`, `detect-risks`, `workload-snapshot` reading all tasks once, `evening-digest` etc.) are small.

### Dismissed with evidence
Socket.IO (defaults, 25 s ping), cron ticker (3 small queries/min, `cron-ticker.server.ts:46-73,381`), Keycloak refresh (12 h token, `keycloak-realm.json:10`), 1 s UI timers, service worker duplication, avatars (no code writes `avatar_url`; it is whatever the identity provider supplies, so the `profiles` selects are small), notifications (paged, delta).

## 4. Direct answers

| Question | Answer |
|---|---|
| Which APIs/queries/components/jobs generate the most traffic? | By *code evidence of per-request size*: (1) attachment rows incl. `file_data` via `select("*")` (TaskHistorySheet, PhotoField, SignatureField), (2) file downloads through `/app-storage/file` (whole bytea each time), (3) file uploads through `/app-storage/upload`, (4) notebook list on every page load, (5) manager server functions. Measured ranking still needs §6. |
| Are Socket.IO / Entity Watcher / duplicate requests contributing? | **Socket.IO: no.** **Entity watcher: yes, a constant floor** (F6) but small relative to total. **Duplicate requests:** yes in two specific forms — uncacheable file URLs (F3) and unscoped task subscribers (F7). The earlier duplicate-request storms are gone at this HEAD. |
| Why still high after optimization? | The optimization reduced task-table payloads. It did not touch API compression, binary files stored in Postgres, signed-URL cache-busting, notebook image payloads, or the 3 s watcher. |

## 5. Comparison with Part 1

| Part 1 | Status now |
|---|---|
| F1 whole-table reads + fan-out | **Withdrawn as cause** (optimized code is live). Residual: F7 above. |
| F2 no compression | **Unchanged, confirmed. Now the top lever.** |
| F3 watcher polling | Unchanged, confirmed, small floor. |
| F4 manager server functions | Unchanged, POTENTIAL; depends on `SUPABASE_URL` routing. |
| F5 `select("*")` on tasks | Superseded: the dangerous `select("*")` is on **attachments** (F2 here), not tasks. |
| not looked at | **New:** file storage in Postgres (F2-F4), notebook images (F5), scheduled hooks (F8). |

## 6. Read-only measurements that decide the ranking (run on the production host)

All are `SELECT`s or `docker` read commands; none print file contents or secrets.

1. **Attachment weight (F2-F4):**
   `SELECT count(*), pg_size_pretty(sum(file_size)), pg_size_pretty(max(file_size)), pg_size_pretty(pg_total_relation_size('public.attachments')) FROM public.attachments;`
2. **Notebook weight (F5):**
   `SELECT user_id, count(*), pg_size_pretty(sum(octet_length(content)+octet_length(images::text))) FROM public.notebook_notes GROUP BY 1 ORDER BY sum(octet_length(content)+octet_length(images::text)) DESC;`
3. **Who reads/writes what, with deltas** (one minute apart, work hours and ~02:00): `SELECT relname, seq_tup_read, idx_tup_fetch, n_tup_ins, n_tup_upd FROM pg_stat_user_tables ORDER BY seq_tup_read+idx_tup_fetch DESC LIMIT 15;` (`pg_stat_statements` is not loaded: only `pg_cron` is preloaded, `infra/docker-compose.yml:16`.) Also `SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;` and `SELECT pg_size_pretty(pg_total_relation_size('public.attachments'));` — if `attachments` dominates table sizes, F2-F4 are the answer.
4. **Counter ratio per container:** `docker stats --no-stream` twice, 60 s apart, at 02:00. Night in/out for `app` = watcher + hooks floor.
5. **Route of server-function reads:** `docker exec <app> printenv SUPABASE_URL` (this variable only).
6. **Browser check (one person, DevTools → Network, "Disable cache" off):** open a task with a photo field twice; if the image downloads twice with different `token=`/`expires=` query strings, F3 is confirmed live. Sort by Size to see the largest responses.
7. Caddy has no access log (`infra/Caddyfile` has no `log`), so per-endpoint API bytes cannot be attributed today.

## 7. Recommended fixes, ranked by expected impact (nothing implemented)

| Rank | Fix | Touches | Risk | Addresses |
|---|---|---|---|---|
| 1 | Add `encode zstd gzip` to the API site block | `infra/Caddyfile` | Very low | F1 (and halves/more every JSON byte incl. bytea hex) |
| 2 | Replace `select("*")` on `attachments` with explicit metadata columns (as `listAttachmentsFn` does) in the 3 components; for PhotoField/SignatureField select only `storage_path` | `TaskHistorySheet.tsx:62`, `PhotoField.tsx:39`, `SignatureField.tsx:26` | Low | F2 |
| 3 | Make the file URL stable per file per time bucket (e.g. HMAC over `path` + a 1-hour-rounded expiry) so the browser cache works; add `ETag`/`304` to `file.ts` | `storage.ts:27-35`, `file.ts` | Low-medium (security review of token lifetime) | F3 |
| 4 | Move `ALTER TABLE` out of the upload request into the one-time ensure pattern; compress images client-side for all attachment uploads; consider a size cap well under 20 MB for images | `upload.ts:29`, `attachments.ts`, `AttachmentsPanel` | Low | F4 |
| 5 | Notebook: list metadata first (no `content`/`images`), load a note's images on open; store images as attachments (compressed) instead of base64 in the note; save only the changed note body | `notebook.functions.ts`, `notesStore.ts`, `RichNoteEditor.tsx` | Medium | F5 |
| 6 | Install the realtime push triggers so the watcher stands down, or raise `OPERON_CHANGE_WATCH_MS` to 10-15 s as an interim | DB migration / env | Medium / low | F6 |
| 7 | Scope the 10 unscoped `useRealtimeTasks` pages to what each page truly needs; send task events to the assignee and managers instead of everyone | `use-realtime-tasks.ts`, `entity-watcher.server.ts:49` | Medium (RLS parity) | F7 |
| 8 | Longer term: move binaries out of Postgres to object storage (the compose already references a `minio` upstream in the Caddyfile but defines no such service) | infra | High | F2-F4 root |

### Expected effect (ESTIMATES; re-measure after each step)
- **#1:** typically 85-95% less bytes on the wire for JSON; the biggest immediate lever regardless of the other findings.
- **#2:** removes the bytea from those three requests entirely (each such response drops from "file size × 2" to under a kilobyte). Size of saving = whatever §6 query 1 shows.
- **#3:** repeat previews become cache hits instead of whole-file reads (Postgres + app + network each).
- **#6:** removes the ~0.14-0.2 MiB/min constant floor and ~288k queries/day.
- **#5:** removes the per-page-load note payload; large only if §6 query 2 shows image-heavy notes.

## 8. What I cannot claim

I cannot say which of F2-F5 dominates your totals until queries 1-3 above are run, and I cannot rule out that the 60-second sample was a single large upload. I did not find any remaining client polling loop, repeating timer, or write-feedback loop in the code (writes to watched tables come only from user actions and scheduled hooks).

*No fixes will be applied until you approve.*

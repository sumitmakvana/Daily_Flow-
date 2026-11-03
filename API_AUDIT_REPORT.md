# Operon API Audit Report

Date: 2026-11-03 · Branch: `fix/api_call_pattern_changed` · Method: static code analysis only (working tree including uncommitted changes). **No code was modified. Nothing was run or measured at runtime.**

> **Metric policy.** Request counts, payload bytes and latency are runtime facts. They are marked **"Not measured"** unless the code itself bounds them (e.g. `.limit(50)`, chunk of 500, `staleTime`, interval). "Frequency" means what the code dictates (trigger, timer, debounce), not observed volume.

## 1. Total API count

Counts are **call-site inventory rows** (one row per distinct call site / endpoint definition), not request instances. Server-function rows (Part B) are also invoked from pages listed in the page maps; they are not double-counted in the total.

| Category | Count | Source |
|---|---|---|
| Browser PostgREST calls (100 GET, 12 HEAD-count, 14 POST, 5 PATCH, 4 DELETE = 135; plus 1 RPC) | 136 | Part A |
| Keycloak token POSTs / redirect | 4 / 1 | Part A |
| Upload POST / `/api/public/hooks` POSTs / external date.nager.at GET / local fetch | 1 / 3 / 1 / 1 | Part A |
| **Part A subtotal (rows C-001..C-147)** | **147** | |
| Server functions (`createServerFn`: 51 GET, 92 POST; 1 more is commented out) | 143 | Part B |
| Non-serverFn HTTP route handlers (11 cron hooks, 4 email actions, 2 `/app-storage`) | 17 | Part B |
| Socket.IO connection + events (2 client→server, 5 server→client) | 1 + 7 | Part C |
| Server-side background jobs / listeners / timers | 27 | Part C |
| Infra / external endpoints | 10 | Part C |
| Other clients (extension, desktop, mobile) | 8 | Part C |
| **Grand total inventory rows** | **360** | |

Additional facts: 29 Socket.IO subscription sites (28 live, 1 dead). No HTTP `refetchInterval` exists anywhere; the only client timer-driven request is the 60 s Keycloak `updateToken(70)` (`src/integrations/backend/auth.ts:107`). 24 of 143 server functions have no client caller.

## 2. Key findings (summary)

1. **Realtime-triggered refetch storms (highest traffic).** Manager sockets receive every org-wide task event; pages refetch broadly on each: `getManagerCommand` = 10 HTTP calls per event, up to 6 runs per action on `/manager` (three separately throttled subscriptions, no debounce); `/tasks` fires up to 15 HEAD count requests 1.2 s after each event (`tasks.tsx:429`); `/command` 4–5 requests per event.
2. **Full-table reads.** `fetchIntelligenceBundle` runs `SELECT * FROM tasks` with no WHERE; time-tracking reads all tasks + worklogs (`time-tracking.tsx:92-93`); planning and blockers reload everything per task event (`planning.tsx:37`, `blockers.tsx:21`); dashboard/command/workload do full scans every 5 min; eod table view pages through all completed tasks on every event (`task-window.ts:489-504`).
3. **Token refresh side effects.** Every full page load forces a Keycloak refresh (`auth.ts:67-73`); each refresh yields a new `user` object, re-running `getMyRoles`, the AppShell profile load and MorningResumePromptModal queries.
4. **Duplicate reads.** Five pages read `user_roles` in `beforeLoad` on top of the layout `getMyRoles`; `fetchLeavesFn` (5 pages), `listHolidaysFn`, `listWorkItemTypesFn` (10+ sites, only the task form caches), `getWorkSettingsFn`, `listTaskReviewsFn` (one per review card on every decision event), `listAttachmentsFn`, `listMentionableUsersFn`; profiles/projects/teams/`profile_emails` bypass the shared people cache.
5. **N+1 / per-row fan-out.** `deleteUser` ≈19–23 round trips + 2 DDL; `getForecast` 11 HTTP calls; `importConfigFn` one statement per row; `ensureMasterProject` select+insert per name; configure/new wizard one POST per status/field/step; bulk task create/update/delete one request per row; exports 4 queries per project with unchunked `IN (...)`.
6. **Reconnect herd.** Server restart → every client `resync`s and refetches everything at once.
7. **Config.** QueryClient sets only `retry` (focus/reconnect refetch stays on, `src/router.tsx:7-9`); every PostgREST call sends `Cache-Control: no-store` (`client.ts:45-90`).
8. **Server-side.** 60 s cron ticker ≈ 5,760 statements per working day; 30 s `SELECT 1` outbox heartbeat; cron-auth adds 3 PostgREST calls per hook invocation; `submitDemoFeedback` runs `CREATE TABLE IF NOT EXISTS` per call; `LISTEN entity_changed` has no trigger in the repo (dead).
9. **Dead code.** 24 unused server functions, NudgeCenter (not mounted), `nudgesService.generateNow`, MyTodayWorkSummaryCard self-fetch, four unused task-window helpers, heatmap route (commented out).
10. **Security observations noticed incidentally (not performance).** `?force=true` bypasses cron auth on morning-digest, evening-digest, no-tasks-reminder; email action links trust a caller-supplied userId; `clearAllDemoFeedback` is a TRUNCATE with no role check; UI buttons calling cron hooks send no cron headers (would 401 as coded); `FILES_DOMAIN` → `minio:9000` but no minio service is defined in repo infra.

## 3. Prioritized optimization suggestions

| Priority | Suggestion | Evidence | Expected effect |
|---|---|---|---|
| P0 | Debounce/coalesce realtime-driven refetches per page (shared trailing debounce, e.g. 1–2 s); scope manager subscriptions to relevant entities instead of every org task event | `/manager` up to 6× `getManagerCommand`; `tasks.tsx:429`; `/command` | Largest request-count reduction; magnitude Not measured |
| P0 | Replace full-table reads with windowed/delta queries (extend the `task-window.ts` approach) on intelligence, time-tracking, planning, blockers, eod table | `fetchIntelligenceBundle`, `time-tracking.tsx:92-93`, `planning.tsx:37`, `blockers.tsx:21` | Smaller payloads, lower DB load; Not measured |
| P0 | Collapse `getManagerCommand` (10 HTTP) and `getForecast` (11 HTTP) into fewer server-side queries | Part B F-2, F-4 | Fewer round trips per event |
| P1 | Stop `user` identity churn on token refresh (key hooks on `user.id`); avoid forced refresh on load | `auth.ts:67-73`, C-020/C-021 | Removes repeat `getMyRoles`/profile/morning-modal queries |
| P1 | Add `staleTime`/`slowChanging()` and shared query keys for leaves, holidays, work-item-types, work settings, mentionable users, attachments; read `user_roles` once via layout context instead of 5 `beforeLoad`s | Part B F-3, Part A findings | Removes duplicates |
| P1 | Set sensible QueryClient defaults (`refetchOnWindowFocus: false` where realtime covers; staleTime > 0) | `router.tsx:7-9` | Cuts focus/mount refetches |
| P1 | Batch per-row fan-out: bulk insert/update/delete, `IN` chunking in exports, batched config import, single upsert for master project | Part B F-4 | N→1 requests |
| P1 | Per-card `listTaskReviewsFn` → one batched call keyed by task ids | Part C findings (AppShell) | Removes per-card calls on each decision event |
| P2 | Jitter/stagger `resync` after reconnect; deltas instead of full refetch | Part C | Avoids thundering herd |
| P2 | Remove DDL from request paths (`submitDemoFeedback`, `deleteUser`) | Part B | Lower latency, less lock risk |
| P2 | Remove cron-auth's 3 PostgREST calls per hook; confirm external scheduler cadence vs its 30 s rate limit | Part C | Fewer background calls |
| P3 | Delete dead code: 24 unused server fns, NudgeCenter, dead `LISTEN entity_changed`, unused helpers; drop `no-store` on cacheable reads | Parts A–C | Maintenance, bundle size |
| Security | Triage the §2 item 10 items | Part B F-6 | Not performance-related |

Note: the stale `dist/` build (2026-10-28) supplied the `/_serverFn/<hash>` ids; 133 of 143 are available and the 10 missing ones are labelled in Part B.

## 4. Page-wise inventory

Page-wise maps are in each part: **Part A §2** (client calls per route; "Global / shell" calls are inherited by all `_authenticated` routes), **Part B §2** (server functions per route), **Part C §5** (realtime subscriptions and the HTTP refetches they cause). A page's full API set is the union of Global/shell calls plus its entries in the three maps.

---

# Part A — Browser-side calls (PostgREST, RPC, auth, storage, fetch)


Scope: src/ excluding *.server.ts and *.functions.ts bodies. Facts are code-derived; "Not measured" means no byte/latency number can be derived from code.
Paths are relative to `C:\Users\sumit\Downloads\Daily Flow Postgres\`. All line numbers were read from the files.

Legend (Flags column): DUP=duplicate-of; STAR=`select('*')` (or `*, worklogs:...`); NOLIM=no `.limit()/.range()`/head; LOOP=in a loop / N+1 / chunk loop; POLL=timer driven; RT=refetched on a realtime (Socket.IO) event; DEAD=no client caller found.
Method column: GET/POST/PATCH/DELETE = PostgREST verbs; HEAD = supabase-js `{count:'exact', head:true}`; RPC = POST /rest/v1/rpc; NAV = browser navigation; EXT = third-party host.
All PostgREST calls go through `src/integrations/supabase/client.ts:45-90` (custom fetch adds Authorization from localStorage `kc_token` and no-cache headers; read-only build blocks non-GET). Base URL is `VITE_SUPABASE_URL` (Caddy). Endpoint column shows the path after the base URL.

### 0. Global traffic configuration (affects every query)

| Item | Evidence |
|---|---|
| QueryClient defaults: only `retry: shouldRetryQuery`. staleTime=0, refetchOnWindowFocus=true, refetchOnReconnect=true, refetchOnMount=true (react-query v5 defaults) apply to every `useQuery` that does not override them | src/router.tsx:7-9 |
| Queries that override: `realtimeCovered()` = staleTime 30s, no focus/reconnect refetch; `slowChanging()` = staleTime 5 min, no focus/reconnect refetch | src/lib/smart-query.ts:24-32 |
| useQuery sites relying on DEFAULT focus/reconnect refetch: time-tracking.tsx:71, :78, :88 (staleTime 30s/30s/10s, focus refetch ON); my-day.tsx:248 (staleTime 2 min, focus ON); my-day.tsx:294 (staleTime 2 min, focus ON, server fn); use-review-decisions.ts:19 (staleTime 10 s, server fn); executive.tsx:176 (staleTime Infinity) | files as listed |
| `refetchInterval`: none anywhere in src (grep). Only comments say "No refetchInterval" | executive.tsx:297, manager.tsx:24, my-day.tsx:303 |
| Timer-driven network: Keycloak refresh interval 60000 ms (C-002); socket safety refresh while disconnected 60s,120s,240s then every 300s (calls registered handlers: notifications resync only) | auth.ts:107-120; integrations/realtime/socket.ts:43,64-90 |
| Local-only timers (no network): TaskHoursBadges.tsx:47 (1000 ms, per running-timer card), TaskDetailModal.tsx:175 (1000 ms), use-minute-tick.ts:8 (60000 ms) | |
| Realtime is Socket.IO, not HTTP polling. Channel layer coalesces events: THROTTLE_MS=250 leading+trailing; on tab return after hidden >=5000 ms a resync is sent; reconnect resync refetches subscribers | integrations/realtime/channel.ts:47-51; socket.ts:45,236-254 |
| Shared in-memory caches that cut duplicates: people (TTL 4 min, people.ts:23), own profile (3 s share, my-profile.ts:21), roles (60 s, use-auth.ts:23), task-form options (5 min / leaves 60 s, task-form-options.ts:28-30), global search (5 s reuse, task-search.ts:33) | |

### 1. Table of calls

| ID | Method | Endpoint | file:line | Component / route | Purpose | Trigger | DB tables / columns / filters | Frequency (from code) | Data size | Flags |
|---|---|---|---|---|---|---|---|---|---|---|
| C-001 | POST | Keycloak `/realms/lovable/protocol/openid-connect/token` (refresh_token grant) | src/integrations/backend/auth.ts:67-73 init; vendor node_modules/keycloak-js/dist/keycloak.js:879 `updateToken(-1)` | Global (initKeycloak via auth.getSession at routes/_authenticated.tsx:40,59 and every useAuth/onAuthStateChange) | Startup session restore: saved token+refreshToken given, checkLoginIframe=false => keycloak-js forces a refresh | First getSession per full page load/reload when `kc_token` and `kc_refresh_token` exist | n/a (auth) | Once per full page load (module-level initPromise) | Not measured | Forced refresh even if token still valid (vendor code path `minValidity == -1`) |
| C-002 | POST | Keycloak token endpoint (refresh_token grant) | src/integrations/backend/auth.ts:107-120 | Global | Keep token fresh | `setInterval` 60000 ms, `updateToken(70)`; request only when token expires within 70 s (keycloak.js:1232) | n/a | Timer every 60 s per page load; actual POST frequency depends on token lifetime (Not measured). Interval is never cleared | Not measured | POLL |
| C-003 | POST | Keycloak token endpoint | src/integrations/backend/auth.ts:160-174; caller src/hooks/use-native-app.ts:36 | Global (native Android app only) | Refresh on app resume | onResume | n/a | Per resume, only if token expires within 70 s | Not measured | |
| C-004 | POST | Keycloak token endpoint (password grant, ROPC) | src/integrations/backend/auth.ts:197 | /login | Login | Login form submit | n/a | Once per submit | Not measured | |
| C-005 | RPC | `/rest/v1/rpc/ensure_user_profile` | src/integrations/backend/auth.ts:42 (called :91 init, :240 login) | Global | Create profile/role rows if missing | After Keycloak init success or ROPC login; skipped if sessionStorage `ensured_profile:<id>` set or read-only build | function ensure_user_profile(user_id,user_email,user_name) | Once per user per browser session (retried only after failure) | Not measured | |
| C-006 | NAV | Keycloak auth / registration / logout pages (+ authorization-code exchange POST to token endpoint, vendor, on return) | src/integrations/backend/auth.ts:252, :261, :278 | /login, AppShell logout | Redirect login, register, logout | Click | n/a | Per click | n/a | |
| C-007 | POST | `/app-storage/upload` (multipart; server then writes MinIO) | src/integrations/backend/storage.ts:86; callers src/services/attachments.ts:49, src/lib/offline-queue.ts:187 | TaskFormDialog / TaskDetailModal attachments, PhotoField offline photo.upload | Upload one file | Submit / offline queue drain | storage bucket | Per file | Full file size, Not measured | LOOP in TaskFormDialog.uploadPendingFilesToTask (TaskFormDialog.tsx:712 sequential per file) |
| C-008 | EXT GET | `https://date.nager.at/api/v3/publicholidays/{year}/IN` | src/lib/format.ts:287; callers HolidayBanner.tsx:84, TaskFormDialog.tsx:307, routes/_authenticated/calendar.tsx:168, settings.operations.tsx:379 | Shell (HolidayBanner), calendar, TaskFormDialog, settings.operations | Public holidays | Mount / dialog open / year change | n/a | At most once per year per browser: good answer cached in memory+localStorage `in_holidays_<year>`; failure remembered 6 h (format.ts:236) | Not measured | In-flight de-duplicated (format.ts:275) |
| C-009 | GET | arbitrary note-image URL (`fetch(src)`) | src/components/AppShell.tsx:161 | Shell (notepad "convert to task") | Turn note images into files | Click | n/a | Once per image per click | Not measured | LOOP over images |
| C-010 | POST | `/api/public/hooks/generate-nudges` | src/services/nudges.ts:18 | none (nudgesService.generateNow has no caller; NudgeCenter.tsx is not mounted anywhere) | Trigger nudge generation | - | server hook | Never called | n/a | DEAD |
| C-011 | POST | `/api/public/hooks/planning-suggestions` | src/services/planning-suggestions.ts:24; caller components/SuggestionsPanel.tsx:43 | /command, /planning-suggestions | Regenerate suggestions | Click "refresh" | server hook | Per click | Not measured | |
| C-012 | POST | `/api/public/hooks/detect-risks` | src/services/risks.ts:33; caller routes/_authenticated/command.tsx:106 | /command | Run risk detection | Click | server hook | Per click | Not measured | |
| C-013 | GET | `/rest/v1/profiles?select=display_name,email,avatar_url&id=eq.<me>` | src/lib/my-profile.ts:28 | Shell: AppShell.tsx:208 (effect deps `[user]`, :225), MorningResumePromptModal.tsx:56, my-day.tsx:222 | Own profile | Mount; re-runs on every `user` object change (new object each Keycloak TOKEN_REFRESHED/SIGNED_IN event, auth.ts:99,114,169) | profiles, 3 columns, id=eq | Once per page load (3 callers share one request if within 3000 ms, my-profile.ts:21); again per token refresh | maybeSingle: 1 row, Not measured | DUP across 3 callers (collapsed by 3 s share) |
| C-014 | HEAD | `/rest/v1/notifications?select=id&user_id=eq.<me>&read_at=is.null&created_at=gte.<now-24h>` | src/hooks/use-notifications.tsx:169 (loadUnreadCount) | Shell (NotificationsProvider routes/_authenticated.tsx:108) | Unread badge | Mount per userId (:369); socket resync on reconnect (:392-393) and while list not opened (resync :318) | notifications | Once per page load + once per reconnect/long-tab-return/safety refresh | count only | RT (resync) |
| C-015 | GET | `/rest/v1/notifications?select=id,user_id,type,title,body,task_id,read_at,created_at&user_id=eq&created_at=gte.<24h>&order=created_at.desc&limit=50` | src/hooks/use-notifications.tsx:246 (runLoad, first load) | Shell; NotificationsModal.tsx:101, routes/_authenticated/notifications.tsx | Notification list | First open of panel/inbox, or reopen after >30 s (OPEN_REFETCH_AFTER_MS, :53); resync once list was opened | notifications | Per panel open (>30 s apart) | <=50 rows, Not measured | RT (resync) |
| C-016 | GET | `/rest/v1/notifications?select=id,read_at&...&limit=50` | src/hooks/use-notifications.tsx:222 | Shell | Light index refetch of held list | runLoad when list already held | notifications id,read_at | Per list refetch | <=50 rows (about 75 bytes/row per code comment :220) | RT |
| C-017 | GET | `/rest/v1/notifications?select=<cols>&id=in.(missing)` | src/hooks/use-notifications.tsx:234 | Shell | Full rows for unseen ids | After C-016 when ids missing | notifications | Per list refetch with new rows | bounded by <=50 ids | RT |
| C-018 | HEAD | notifications unread older than page | src/hooks/use-notifications.tsx:147 | Shell | Older-unread count | After list load when page full | notifications | Per list load/loadMore with full page | count only | |
| C-019 | GET | notifications older page, limit 50 | src/hooks/use-notifications.tsx:329 | Shell | "Load more" | Click | notifications cursor created_at | Per click | <=50 rows | |
| C-020 | GET | `/rest/v1/tasks?select=*&assigned_to=eq&started_at=not.is.null&status=neq.Completed&order=updated_at.desc&limit=1` | src/services/tasks.ts:224 (getActiveTask) | Shell MorningResumePromptModal.tsx:67 (mounted in layout _authenticated.tsx:112); TaskCard.tsx:199,:221; TaskDetailModal.tsx:198,:305; TaskQuickActionModal.tsx:94; KanbanBoard.tsx:116 | Find running timer | Morning modal effect (deps `[user]`, :162) on each page load and each token refresh until `last_morning_resume_prompt_date`==today (set only on dismiss/start/running-today, :52,:76,:165); timer start/resume click elsewhere | tasks | Morning modal: once per page load (+per token refresh) while key unset; others per click | 1 row, all columns | STAR |
| C-021 | GET | `/rest/v1/tasks?select=*&assigned_to=eq&order=updated_at.desc&limit=30` | src/services/tasks.ts:240 (queryTasks); only caller MorningResumePromptModal.tsx:82 | Shell (all authenticated routes) | Pick morning focus task | Same trigger as C-020 (after C-020 when no timer started today) | tasks all columns | Once per page load (+per token refresh) while prompt key unset | <=30 full rows, Not measured | STAR |
| C-022 | GET | `/rest/v1/profiles?select=id,display_name,avatar_url` | src/lib/people.ts:61 (loadPeople) | Callers: blockers, calendar, command, dashboard, heatmap(disabled), intelligence, my-day (useQuery key my-day-people), planning-suggestions, planning, reviews, tasks, time-tracking, workload, TaskFormDialog.tsx:388, UserPicker.tsx:18 | People list (RLS-scoped) | Page mount / realtime reload callbacks | profiles 3 cols, no filter | Cached 4 min (PEOPLE_TTL_MS) + in-flight shared; so about once per 4 min or after invalidatePeople (admin.tsx:140,155) | all visible profiles, NOLIM, Not measured | NOLIM |
| C-023 | GET | `/rest/v1/profiles?select=id,display_name,email,avatar_url,team_id,manager_id` | src/lib/people.ts:62 (loadPeopleDetailed) | GlobalSearchModal.tsx:93, eod.tsx:84, executive.tsx:184 | People with email/team | Mount / search open | profiles 6 cols, no filter | Same 4-min cache; a fresh detailed list also serves "basic" (people.ts:73) | all visible profiles, NOLIM | NOLIM, DUP-of C-022 (superset) |
| C-024 | GET | `/rest/v1/tasks?select=id,task_code,task_name,project_name,client,remarks,status,priority,assigned_to&...&order=updated_at.desc,id.asc` + `Range` | src/lib/task-search.ts:117 (searchTaskPage) | Shell GlobalSearchModal.tsx:121 | Search results page | Ctrl+K modal open, query change debounced 120 ms (empty query: 0 ms), tab/page change; same key reused for 5 s | tasks, count=exact, ilike on 5 text fields via applyMatch, scope own/all | Per keystroke after 120 ms debounce | PAGE_SIZE=6 rows via `.range` (GlobalSearchModal.tsx:35) | |
| C-025 | GET | `/rest/v1/tasks?select=status` (count exact, limit 1000) | src/lib/task-search.ts:132 | GlobalSearchModal.tsx:92 | Tab counters | Same debounce | tasks status, `.limit(STATUS_SAMPLE=1000)` | Per keystroke after 120 ms | <=1000 tiny rows | |
| C-026 | HEAD | tasks head counts x4 (in_progress, pending, completed, in_review) | src/lib/task-search.ts:144 | GlobalSearchModal | Exact counters when >1000 matches | Only if C-025 total > 1000 | tasks | Up to 4 per keystroke in that case | counts | LOOP-ish (4 parallel) |
| C-027 | GET | `/rest/v1/tasks?select=*&id=eq` | src/lib/task-search.ts:160 (fetchFullTask) | GlobalSearchModal.tsx:177 | Open task detail | Click | tasks | Per click | 1 row | STAR |
| C-028 | GET | `/rest/v1/profiles?select=id,display_name,email,avatar_url,team_id,manager_id&or=(display_name.ilike,email.ilike)&limit=20` | src/lib/task-search.ts:172 (searchMembers) | GlobalSearchModal.tsx:93 | Member search | Typed query, 120 ms debounce | profiles | Per keystroke after debounce | <=20 rows | |
| C-029 | GET | `/rest/v1/task_history?select=*&task_id=eq&order=created_at.desc&limit=50` | src/components/TaskFormDialog.tsx:504 | Shell TaskFormDialog (AppShell.tsx:798), also mounted in TaskCard, calendar, exports, my-day, tasks, team-capacity | Edit-dialog timeline | Dialog open with existing task id | task_history | Per dialog open | <=50 rows | STAR |
| C-030 | GET | `/rest/v1/projects?select=id,name&name=ilike.<name>` | src/components/TaskFormDialog.tsx:689 (ensureMasterProject; caller :730) | TaskFormDialog | Check master project | Save task | projects | One per `|`-separated project name per save | 1 row | LOOP (:686), N+1 |
| C-031 | POST | `/rest/v1/projects` | src/components/TaskFormDialog.tsx:695 | TaskFormDialog | Auto-create project | Save task when absent | projects insert | Per new project name | write | LOOP |
| C-032 | GET | `/rest/v1/tasks?select=*&id=eq` (.single) | src/components/TaskFormDialog.tsx:753 | TaskFormDialog | Re-read after conflict | Save conflict only | tasks | Rare | 1 row | STAR |
| C-033 | GET | `/rest/v1/projects?select=id,name,client&order=name&limit=1000` | src/lib/task-form-options.ts:77 | TaskFormDialog.tsx:438 | Project picker | Dialog open | projects | Cached 5 min (OPTIONS_TTL_MS) | <=1000 rows | |
| C-034 | GET | `/rest/v1/tasks?select=assigned_to,client,project_name&order=created_at.desc&limit=1000` | src/lib/task-form-options.ts:95 | TaskFormDialog.tsx:394,:439 via loadTaskNameHints | Fallback when server fn fetchTaskNameHintsFn fails | Dialog open, only on server-fn failure | tasks | Cached 5 min | <=1000 rows | |
| C-035 | GET | `/rest/v1/task_history?select=*&task_id=eq&order=created_at.desc&limit=<n>` | src/components/TaskHistorySheet.tsx:60 | TaskCard (mounted per card, loads only when `open`) | History sheet | Sheet open / "load more" | task_history | Per open (4 parallel with C-036..038) | limit n (HISTORY_PAGE=50, TaskHistorySheet.tsx:21, increases on load more) | STAR |
| C-036 | GET | carry_forward_events `*` limit n | src/components/TaskHistorySheet.tsx:61 | same | same | same | carry_forward_events | same | limit n | STAR |
| C-037 | GET | attachments (8 columns) limit n | src/components/TaskHistorySheet.tsx:62 | same | same | same | attachments | same | limit n | |
| C-038 | GET | comments `*` limit n | src/components/TaskHistorySheet.tsx:63 | same | same | same | comments | same | limit n | STAR |
| C-039 | GET | `/rest/v1/profiles?select=id,display_name,email,avatar_url,manager_id&is_active=eq.true&order=display_name` | src/components/LeaveDialog.tsx:86 | LeaveDialog (calendar, leaves, MyLeaveReportDialog) | Request-to dropdown | Dialog open | profiles | Per dialog open, not cached | all active profiles, NOLIM | NOLIM, DUP-of C-022 |
| C-040 | GET | `/rest/v1/attachments?select=storage_path&id=eq` | src/components/fields/PhotoField.tsx:39 | DynamicFieldsForm photo fields | Resolve preview | Mount per field with attachment_id and no preview_url (effect :34) | attachments | Once per field mount/value change; followed by signed-URL server fn + image GET to MinIO | 1 row | LOOP across fields |
| C-041 | GET | same | src/components/fields/SignatureField.tsx:26 | DynamicFieldsForm signature fields | Resolve preview | Mount per field with attachment_id | attachments | same | 1 row | LOOP across fields |
| C-042 | GET | `/rest/v1/profile_emails?select=id,email` | src/components/CSVImportDialog.tsx:302 | /tasks CSV import | Name-to-user mapping | Dialog open | profile_emails view | Per dialog open | all rows, NOLIM | NOLIM, DUP-of C-122 |
| C-043 | GET | `/rest/v1/tasks?select=id,task_code,task_name,assigned_to,due_date,version` | src/components/CSVImportDialog.tsx:314 | /tasks CSV import | Duplicate detection | Dialog open | tasks, no filter | Per dialog open | every task row, 6 cols, NOLIM | NOLIM |
| C-044 | GET | `/rest/v1/tasks?select=*&assigned_to=eq` | src/components/MyTodayWorkSummaryCard.tsx:80 | Only mounted in my-day.tsx:735 which always passes `allTasks`, so the effect returns early (:77) | Self-fetch fallback | Never in current wiring | tasks | Never | would be all own tasks | STAR, NOLIM, DEAD(path) |
| C-045 | GET | `/rest/v1/tasks?select=*&id=eq` | src/components/SuggestionsPanel.tsx:58 | /command, /planning-suggestions | Read row to accept suggestion | Click accept | tasks | Per click | 1 row | STAR |
| C-046 | GET | `/rest/v1/tasks?select=id,task_name&id=in.(...)` | src/components/TomorrowRiskPanel.tsx:28 | /command, /planning-suggestions | Names of top risks missing from props | Effect on risk-key change (:24-35) | tasks | Per change of top risks | <=8 ids (TOP_RISKS, TomorrowRiskPanel.tsx:8) | |
| C-047 | POST | `/rest/v1/tasks` | src/lib/offline-queue.ts:159 | SyncStatusBadge (shell, AppShell.tsx:328) via useOnlineSync, /sync | Replay queued task create | Mount, focus (use-online-sync.ts:35), online event, if queue non-empty | tasks | Per queued op, up to MAX_ATTEMPTS retries with 2-8 s backoff (:136) | write | LOOP (sequential drain) |
| C-048 | PATCH | `/rest/v1/tasks?id=eq` | src/lib/offline-queue.ts:168 | same | Replay queued update | same | tasks | same | write | LOOP |
| C-049 | POST | `/rest/v1/comments` | src/lib/offline-queue.ts:173 | same | Replay queued comment | same | comments | same | write | LOOP |
| C-050 | POST | `/rest/v1/<table>` (dynamic) | src/lib/offline-queue.ts:179 | same | Replay queued form submit | same | table from payload | same | write | LOOP |
| C-051 | HEAD | `/rest/v1/tasks?select=id` (count total for type) | src/lib/automation/impact.ts:73 | components/automation/RuleEditorDrawer.tsx:221 -> ImpactAnalysis.tsx | Rule impact preview | Any change of rule input, 400 ms debounce (ImpactAnalysis.tsx:15) | tasks, optional type_id=eq | Per edit after 400 ms | count only | |
| C-052 | HEAD | tasks matching count | src/lib/automation/impact.ts:79 | same | same | same | tasks | same | count only | |
| C-053 | GET | `/rest/v1/work_item_types?select=key&key=in.(..)` | src/lib/automation/impact.ts:130 | same | Gap detection | same | work_item_types | same (up to 5 parallel checks C-053..057) | small | |
| C-054 | GET | org_roles key in | src/lib/automation/impact.ts:138 | same | same | same | org_roles | same | small | |
| C-055 | GET | work_item_statuses key in | src/lib/automation/impact.ts:146 | same | same | same | work_item_statuses | same | small | |
| C-056 | GET | work_item_field_defs key in | src/lib/automation/impact.ts:154 | same | same | same | work_item_field_defs | same | small | |
| C-057 | GET | approval_chains id in | src/lib/automation/impact.ts:162 | same | same | same | approval_chains | same | small | |
| C-058 | DELETE | `/rest/v1/approval_chains?id=eq` | components/configure/ApprovalsPanel.tsx:65 | /configure | Delete chain | Click | approval_chains | Per click | write | |
| C-059 | DELETE | approval_steps id=eq | components/configure/ApprovalsPanel.tsx:71 | /configure | Delete step | Click | approval_steps | Per click | write | |
| C-060 | POST | approval_chains | components/configure/ApprovalsPanel.tsx:157 | /configure | Create chain | Submit | approval_chains | Per submit | write | |
| C-061 | POST | approval_steps | components/configure/ApprovalsPanel.tsx:201 | /configure | Create step | Submit | approval_steps | Per submit | write | |
| C-062 | GET | `/rest/v1/work_item_field_defs?select=*&type_id=eq&order=sort_order` | components/configure/FieldsPanel.tsx:44 | /configure | List defs incl. archived | Mount and on typeId change (:48); after each edit (:54) | work_item_field_defs | Per type switch / edit | all defs of one type, NOLIM | STAR, NOLIM |
| C-063 | PATCH | field_defs is_active | components/configure/FieldsPanel.tsx:51 | /configure | Archive/restore | Click | work_item_field_defs | Per click | write | |
| C-064 | PATCH | field_defs | components/configure/FieldsPanel.tsx:131 | /configure | Edit field | Submit | work_item_field_defs | Per submit | write | |
| C-065 | POST | field_defs | components/configure/FieldsPanel.tsx:136 | /configure | Add field | Submit | work_item_field_defs | Per submit | write | |
| C-066 | GET | `/rest/v1/profiles?select=id,display_name,email&id=in.(members)` | components/configure/RolesPanel.tsx:174 | /configure RolesPanel MembersDialog | Names of role members | Dialog open and after each assign/remove | profiles | Per open/change | one row per member | DUP-of C-022 (subset) |
| C-067 | DELETE | work_item_statuses id=eq | components/configure/StatusesPanel.tsx:46 | /configure | Delete status | Click | work_item_statuses | Per click | write | |
| C-068 | PATCH | work_item_statuses | components/configure/StatusesPanel.tsx:113 | /configure | Edit status | Submit | work_item_statuses | Per submit | write | |
| C-069 | POST | work_item_statuses | components/configure/StatusesPanel.tsx:114 | /configure | Add status | Submit | work_item_statuses | Per submit | write | |
| C-070 | DELETE | work_item_transitions id=eq | components/configure/WorkflowPanel.tsx:49 | /configure | Delete transition | Click | work_item_transitions | Per click | write | |
| C-071 | POST | work_item_transitions | components/configure/WorkflowPanel.tsx:155 | /configure | Add transition | Submit | work_item_transitions | Per submit | write | |
| C-072 | PATCH | work_item_transitions id=eq | components/configure/WorkflowPanel.tsx:158 | /configure | Edit transition | Submit | work_item_transitions | Per submit | write | |
| C-073 | POST | work_item_statuses (`.select('id').single()`) | routes/_authenticated/configure.new.tsx:149 | /configure/new wizard | Publish new type: statuses | Publish click | work_item_statuses | One request per status in loop (:146) | write | LOOP, N+1 |
| C-074 | POST | work_item_transitions | routes/_authenticated/configure.new.tsx:159 | /configure/new | transitions | same | work_item_transitions | One per consecutive status pair (:158) | write | LOOP |
| C-075 | POST | work_item_field_defs | routes/_authenticated/configure.new.tsx:168 | /configure/new | fields | same | work_item_field_defs | One per field (:166) | write | LOOP |
| C-076 | POST | approval_chains (`.select('id').single()`) | routes/_authenticated/configure.new.tsx:179 | /configure/new | chain | same | approval_chains | Once | write | |
| C-077 | POST | approval_steps | routes/_authenticated/configure.new.tsx:185 | /configure/new | steps | same | approval_steps | One per step (:183) | write | LOOP |
| C-078 | GET | `/rest/v1/user_roles?select=role&user_id=eq` | routes/index.tsx:10 | `/` beforeLoad | Choose landing page | Each visit to `/` | user_roles, user_id=eq | Per visit | few rows | DUP-of roles server fn getMyRoles (use-auth.ts:53 / _authenticated.tsx:69) that runs immediately after the redirect |
| C-079 | GET | `/rest/v1/user_roles?select=role&user_id=eq&role=eq.admin` | routes/_authenticated/admin.tsx:35 | /admin beforeLoad | Admin guard | Each navigation into /admin | user_roles | Per navigation | <=1 row | DUP-of getMyRoles in layout (_authenticated.tsx:69, maxAge 0 on every pathname change) |
| C-080 | GET | same | routes/_authenticated/configure.tsx:22 | /configure beforeLoad | Admin guard | Each navigation | user_roles | Per navigation | <=1 row | DUP (as C-079) |
| C-081 | GET | same | routes/_authenticated/configure.new.tsx:30 | /configure/new beforeLoad | Admin guard | Each navigation | user_roles | Per navigation | <=1 row | DUP |
| C-082 | GET | same | routes/_authenticated/onboarding.tsx:19 | /onboarding beforeLoad | Admin guard | Each navigation | user_roles | Per navigation | <=1 row | DUP |
| C-083 | GET | `/rest/v1/profiles?select=id,display_name,email,avatar_url,manager_id` | routes/_authenticated/admin.tsx:78 | /admin | User admin list | Mount; after every save/delete (:142,:158) | profiles | Per load | all profiles, NOLIM | NOLIM, DUP-of C-023 (no shared cache) |
| C-084 | GET | `/rest/v1/user_roles?select=user_id,role` | routes/_authenticated/admin.tsx:79 | /admin | Roles per user | same | user_roles | same | all rows, NOLIM | NOLIM |
| C-085 | GET | `/rest/v1/tasks?select=completed_at&completed_at=gte.<14d>` | routes/_authenticated/analytics.tsx:38 | /analytics | Completion trend | Mount only (effect `[]`, :50) | tasks completed_at | Once per mount | one row per task completed in 14 d, NOLIM | NOLIM |
| C-086 | GET | `/rest/v1/daily_workload_snapshot?select=*&snapshot_date=gte.<30d>` | routes/_authenticated/analytics.tsx:39 | /analytics | Utilisation trend | Mount | daily_workload_snapshot | Once | 30 d of rows, NOLIM | STAR, NOLIM |
| C-087 | GET | `/rest/v1/carry_forward_events?select=*&created_at=gte.<30d>` | routes/_authenticated/analytics.tsx:40 | /analytics | Carry trend | Mount | carry_forward_events | Once | 30 d rows, NOLIM | STAR, NOLIM |
| C-088 | GET | `/rest/v1/pending_review_assignments?select=reviewer_id` | routes/_authenticated/analytics.tsx:41 | /analytics | Reviewer queue | Mount | pending_review_assignments | Once | all pending, NOLIM | NOLIM, DUP-of C-114 |
| C-089 | GET | `/rest/v1/tasks?select=*&status=eq.Blocked&order=blocked_at.asc` | routes/_authenticated/blockers.tsx:21 | /blockers | Blocked list | Mount (:28) + every task realtime event (useRealtimeTasks :29, scope all, 250 ms throttle) | tasks | Per tasks event on ANY task (unfiltered scope) | all blocked rows, NOLIM | STAR, NOLIM, RT |
| C-090 | GET | `/rest/v1/tasks?select=*&id=in.(day ids)` | routes/_authenticated/calendar.tsx:304 | /calendar day side panel | Full rows for the day | Panel open; effect deps `[sheetOpen, dayIds, tasks]` (:314) so it re-runs on every tasks refresh (realtime) while open | tasks | Per open + per realtime refresh while panel open | one row per task that day (all columns), URL unchunked | STAR, RT |
| C-091 | GET | `/rest/v1/tasks?select=*&id=eq` | routes/_authenticated/calendar.tsx:426 | /calendar | Task detail on click | Click | tasks | Per click | 1 row | STAR |
| C-092 | GET | `/rest/v1/tasks?select=<cols>` + `apply` filter | src/lib/task-window.ts:304 (loadAllTasksSlim full) | calendar.tsx:131 (range+assignee `or=(...)`), command.tsx:40, dashboard.tsx:29, eod.tsx:90,:120 (open + completed today), :263 (snapshot click, all tasks), executive.tsx:199 (range+scope), :396 (export click, all), workload.tsx:24 | Light task set per page | First load per page; again when the last full read is older than 5 min (ALL_TASKS_FULL_RELOAD_MS, :296,:310), when delta fails or head-count mismatches | tasks, page-specific column constants (task-columns.ts) | Per page mount, then every realtime refresh falls to delta (C-093/C-094) except full reload each 5 min | dashboard/command/workload: every task row (NOLIM); calendar/eod/executive: windowed by filter; Not measured | NOLIM (dashboard, command, workload, snapshot, export) |
| C-093 | GET | tasks `<cols>` + `updated_at=gte.<since-60s>` + apply | src/lib/task-window.ts:313 | same callers | Delta refresh | Each realtime task event (after 250 ms throttle) on calendar, command, dashboard, eod, executive, workload | tasks | Per event | rows changed since newest held minus 60 s overlap | RT |
| C-094 | HEAD | tasks count (`select id`) + apply | src/lib/task-window.ts:314 (parallel with C-093) | same callers | Detect deletions | with C-093 | tasks | Per delta refresh | count only | RT |
| C-095 | GET | `/rest/v1/tasks?select=<DASHBOARD_DETAIL_COLS>&id=in.(<=100)` | routes/_authenticated/dashboard.tsx:40 | /dashboard | Detail for Blocked + High-overdue rows | Every `load` (mount + each tasks realtime event, :46,:47 own channel "dash") | tasks | Per event; one request per 100 ids sequentially | rows = Blocked or High-overdue tasks | LOOP (chunk loop :39), RT |
| C-096 | GET | `/rest/v1/projects?select=id,name` | routes/_authenticated/eod.tsx:91 | /eod | Project names | Full `load` only (mount, after carry-forward :256) | projects | Per full load | all projects, NOLIM | NOLIM |
| C-097 | GET | `/rest/v1/tasks?select=*&assigned_to=eq` | routes/_authenticated/eod.tsx:160 | /eod member drawer | Member's full history | Drawer open; re-run when that member's task count/max updated_at changes (drawerSig :141-170) | tasks | Per drawer open + per change of that member's rows | all tasks of one member, NOLIM | STAR, NOLIM, RT |
| C-098 | GET | `/rest/v1/tasks?select=assigned_to&status=eq.Completed&or=(completed_at.lt.X,completed_at.is.null)&order=id&range` | src/lib/task-window.ts:493 (fetchCompletedOutsideWindow); callers eod.tsx:65, :71, :123 | /eod table view | Per-member older completed totals | viewMode=table mount, and on every tasks realtime refresh while in table view (eod.tsx:123) | tasks assigned_to | Per realtime event in table view; one request per 1000 completed rows (CHUNK=1000, :491) | one tiny object per completed task outside today (grows with history) | LOOP (paged), RT, count-by-download (could be a grouped count) |
| C-099 | GET | `/rest/v1/tasks?select=<EXEC_TASK_COLS>&assigned_to=eq` | routes/_authenticated/executive.tsx:218 | /executive member drawer | Member history | Drawer open; scheduled refetch on tasks events (:308, active only); staleTime 30 s | tasks | Per drawer open + per event | all tasks of one member, NOLIM | NOLIM, RT |
| C-100 | GET | `/rest/v1/eod_checkins?select=*&user_id=eq&order=checkin_date.desc` | routes/_authenticated/executive.tsx:229 | /executive drawer | Member check-ins | Drawer open; refetch on eod_checkins events (:315) | eod_checkins | Per open/event | all check-ins of one member, NOLIM | STAR, NOLIM, RT |
| C-101 | GET | `/rest/v1/projects?select=id,name,client,status` | routes/_authenticated/executive.tsx:242 | /executive | Projects | Mount; staleTime 5 min | projects | Once per 5 min | all projects, NOLIM | NOLIM, DUP-of C-133 (different query key, same data) |
| C-102 | GET | `/rest/v1/teams?select=id,name` | routes/_authenticated/executive.tsx:251 | /executive | Teams | Mount; 5 min | teams | Once per 5 min | all teams | DUP-of C-132 |
| C-103 | GET | `/rest/v1/profiles?select=id,display_name,avatar_url,team_id&order=display_name` | routes/_authenticated/exports.tsx:230 | /exports | Filters | Mount (:228 `[]`) | profiles | Once per mount | all profiles, NOLIM | NOLIM, DUP-of C-022 |
| C-104 | GET | teams id,name order name | routes/_authenticated/exports.tsx:231 | /exports | Filters | Mount | teams | Once | all, NOLIM | NOLIM |
| C-105 | GET | projects id,name order name | routes/_authenticated/exports.tsx:232 | /exports | Filters | Mount | projects | Once | all, NOLIM | NOLIM |
| C-106 | GET | `/rest/v1/projects?select=id&name=eq` | routes/_authenticated/exports.tsx:967 (fetchProjectActivity) | /exports ProjectDetailModal (:1210) and "export separate sheets" (:333) | Project id | Modal open / export click | projects | Per modal open; export: one per project | 1 row | LOOP in export (Promise.all over projects :332) |
| C-107 | GET | `/rest/v1/tasks?select=id,task_code,...,project_id&or=(project_name.eq,project_id.eq)&order=updated_at.desc` | routes/_authenticated/exports.tsx:973 | same | All tasks of project | same (+ refetchTrigger :1229) | tasks 12 cols, no date filter | per modal open / per project in export | every task of the project, NOLIM | NOLIM, LOOP in export |
| C-108 | GET | `/rest/v1/profiles?select=id,display_name&id=in.(assignees)` | routes/_authenticated/exports.tsx:1014 | same | Names | same | profiles | same | one per assignee; URL length unbounded | LOOP in export |
| C-109 | GET | `/rest/v1/task_worklogs?select=id,task_id,user_id,work_date,hours,notes,created_at&task_id=in.(ALL ids)&work_date range` | routes/_authenticated/exports.tsx:1024 | same | Worklogs | same | task_worklogs | same | rows in period; `in` list has every project task id, no chunking | LOOP in export, unchunked `in()` |
| C-110 | GET | `/rest/v1/tasks?select=*&id=eq` | routes/_authenticated/exports.tsx:1143 | /exports ProjectDetailModal | Task detail | Click | tasks | Per click | 1 row | STAR |
| C-111 | GET | `/rest/v1/profiles?select=id,display_name&display_name=eq` | routes/_authenticated/exports.tsx:1966 | /exports MemberTasksModal | Resolve member | Modal open; deps incl. refetchTrigger (:2013) | profiles | Per open/refetch | 1 row | |
| C-112 | GET | `/rest/v1/tasks?select=<11 cols>&assigned_to=eq[&project_name=eq]&order=updated_at.desc` | routes/_authenticated/exports.tsx:1974 | same | Member tasks | same | tasks | same | all tasks of member (no date filter), NOLIM | NOLIM |
| C-113 | GET | `/rest/v1/tasks?select=*&id=eq` | routes/_authenticated/exports.tsx:2019 | MemberTasksModal | Task detail | Click | tasks | Per click | 1 row | STAR |
| C-114 | GET | `/rest/v1/pending_review_assignments?select=reviewer_id` | routes/_authenticated/intelligence.tsx:34 | /intelligence | Reviewer queue | Mount | pending_review_assignments | Once | all pending, NOLIM | NOLIM |
| C-115 | GET | `/rest/v1/tasks?select=*&id=eq` | routes/_authenticated/my-day.tsx:202 | /my-day | Quick modal | Click or `?taskId=` deep link (:211) | tasks | Per click | 1 row | STAR |
| C-116 | GET | `/rest/v1/tasks?select=*,worklogs:task_worklogs(7 cols)&assigned_to=eq&or=<recentFilter 14d>&order=due_date,work_date` | src/lib/task-window.ts:344 (fetchMyTasksWithWorklogs) via my-day.tsx:256 | /my-day (key MY_DAY_TASKS_KEY) | My tasks, first/full | Mount; staleTime 2 min (my-day-cache.ts:26) with window-focus refetch ON; full again when delta cannot prove completeness or >5 min | tasks + embedded worklogs, own tasks open + completed in 14 d | Per mount/focus after stale; realtime event debounced 250 ms (my-day.tsx:330) | own open + 14 d completed, all columns, Not measured | STAR, RT |
| C-117 | HEAD | tasks id count (own, recentFilter) | src/lib/task-window.ts:390 | /my-day | Window size for delta | each delta refresh | tasks | Per delta | count only | RT |
| C-118 | GET | tasks `*,worklogs` `updated_at=gte.since` own window | src/lib/task-window.ts:391 | /my-day | Delta rows | each delta refresh | tasks | Per delta | changed rows | STAR, RT |
| C-119 | GET | `/rest/v1/task_worklogs?select=<7 cols>&task_id=in.(<=100)&updated_at=gte.since` | src/lib/task-window.ts:410 | /my-day | Worklog-only changes | Only when delta returned 0 changed task rows | task_worklogs | Per delta with no task change; one request per 100 held ids | rows since | LOOP (chunks), RT |
| C-120 | HEAD | tasks count assigned_to=eq & status=Completed | src/lib/task-window.ts:444; caller my-day.tsx:268 | /my-day | Lifetime completed total | After full load, or when a changed row is/was completed (completedCountMayHaveChanged :434) | tasks | Per qualifying refresh | count only | RT |
| C-121 | GET | `/rest/v1/tasks?select=<PLANNING_COLS>&status=not.in.(Completed)&order=priority` | routes/_authenticated/planning.tsx:37 | /planning (managers) | Board | Mount + EVERY tasks realtime event (:45, no delta) + after each bulk action | tasks, all non-completed | Per event | every open task, NOLIM | NOLIM, RT |
| C-122 | GET | `/rest/v1/profile_emails?select=id,email` | routes/_authenticated/tasks.tsx:295 | /tasks | Search by email | Mount (:290) | profile_emails | Once per mount | all rows, NOLIM | NOLIM, DUP-of C-042 |
| C-123 | GET | `/rest/v1/tasks?select=*,worklogs:task_worklogs(6 cols)&...&order&Range` (count exact) | src/lib/task-list-query.ts:152 via fetchTaskListPage (:166), caller tasks.tsx:337, :421 | /tasks | Page of tasks | Mount, filter/tab/sort/page change (search debounce 250 ms, tasks.tsx:348); fallback after refresh failure | tasks | Per change | `.range` pageSize <= MAX_PAGE_SIZE=50 (task-list-query.ts:37) | STAR |
| C-124 | GET | same builder with `select=id,updated_at` | src/lib/task-list-query.ts:152 via fetchTaskListSignature (:175); caller tasks.tsx:402 | /tasks | Realtime refresh signature | Each task realtime event (own tasks for members, all for managers), after 250 ms throttle | tasks | Per event | <=50 rows (~70 bytes per row per code comment) | RT |
| C-125 | GET | `/rest/v1/tasks?select=*,worklogs&id=in.(<=100)` | src/lib/task-window.ts:466 (fetchTasksByIds); callers tasks.tsx:409,:489, planning.tsx:74, task-window.ts:199 (reconcile) | /tasks refresh (changed ids), bulk actions /tasks and /planning, team-capacity reconcile | Full rows by id | Event with changed ids / bulk click | tasks | Per event with changes / click | chunks of 100 ids | LOOP (chunks), STAR, RT |
| C-126 | HEAD | tasks `{count, head}` x up to 15 per cycle | src/lib/task-list-query.ts:199 (head helper) via fetchSidebarCounts :218 (6 statuses + 3 priorities = 9), fetchTabCounts :267 (3, 1 for members), fetchHeaderCounts :280 (3) | /tasks (managers; members use C-127) | Sidebar, tab and KPI counters | Mount; filter/scope change; `countsTick` bumped 1200 ms after every realtime refresh (tasks.tsx:429) | tasks, filters | Per filter change and per realtime event (after 1.2 s). Identical URLs in flight are de-duplicated (:196-214) | counts only | LOOP-ish (15 parallel), RT |
| C-127 | GET | `/rest/v1/tasks?select=status,priority,due_date,start_date&assigned_to=eq&limit=1001` | src/lib/task-list-query.ts:255; caller tasks.tsx:361 | /tasks (members) | Counters in one request | Mount, countsTick after each realtime refresh | tasks 4 cols | Per event (+1.2 s) | <=1001 small rows (MEMBER_COUNTER_MAX_ROWS=1000, :230) | RT |
| C-128 | GET | tasks `TASK_LIST_COLS` chunks of 500 | src/lib/task-list-query.ts:186; caller tasks.tsx:264 | /tasks | CSV export | Click | tasks | Per click; one request per 500 rows | all matching rows | LOOP (paged) |
| C-129 | GET | `/rest/v1/tasks?select=*,worklogs&id=eq` | src/lib/task-window.ts:453; caller tasks.tsx:461 | /tasks deep link | Open task from link | Mount with `?taskId=/highlight` once | tasks | Once per target id | 1 row | STAR |
| C-130 | GET | `/rest/v1/profiles?select=*&order=display_name` | routes/_authenticated/team-capacity.tsx:229 | /team-capacity (query capacity-profiles) | Profiles | Mount; slowChanging 5 min; (invalidateQueries ["capacity-profiles"] from UnstartedTaskLeaveModal.tsx:56) | profiles all columns | Once per 5 min | all profiles, NOLIM | STAR, NOLIM, DUP-of C-023 |
| C-131 | GET | `/rest/v1/user_roles?select=user_id,role` | routes/_authenticated/team-capacity.tsx:230 | same | Roles | same | user_roles | same | all rows, NOLIM | NOLIM, DUP-of C-084 |
| C-132 | GET | `/rest/v1/teams?select=id,name` | routes/_authenticated/team-capacity.tsx:290 | /team-capacity | Teams | 5 min | teams | | all | DUP-of C-102 |
| C-133 | GET | `/rest/v1/projects?select=id,name,client,status` | routes/_authenticated/team-capacity.tsx:300 | /team-capacity | Projects | 5 min | projects | | all, NOLIM | NOLIM, DUP-of C-101 |
| C-134 | GET | `/rest/v1/tasks?select=*,worklogs:task_worklogs(7 cols)&or=<recentFilter 14d>&order=created_at,work_date` | src/lib/task-window.ts:75 (fetchRecentTasks); caller team-capacity.tsx:268 | /team-capacity (key capacity-tasks) | Open + 14-day completed tasks, all people | Mount; refetch on tasks/task_worklogs events (team-capacity.tsx:320, scheduler); full again if >5 min since last full or cutoff changed (:261) | tasks + worklogs | Per mount (after 30 s stale); per event goes to delta C-135..C-138 | every open task + 14 d completed for whole org, NOLIM, Not measured | STAR, NOLIM, RT |
| C-135 | HEAD | tasks count recentFilter | src/lib/task-window.ts:172 | /team-capacity | Delta: window size | per delta | tasks | Per event | count | RT |
| C-136 | GET | tasks `*,worklogs` recentFilter + `updated_at=gte` | src/lib/task-window.ts:211 | /team-capacity | Delta rows | per delta | tasks | Per event | changed rows | STAR, RT |
| C-137 | GET | `/rest/v1/task_worklogs?select=<7 cols>&updated_at=gte.since` | src/lib/task-window.ts:246 | /team-capacity | Delta worklogs (all people) | per delta (parallel) | task_worklogs, no task filter | Per event | rows since | NOLIM(only time filter), RT |
| C-138 | GET | `/rest/v1/tasks?select=id&or=<recentFilter>` | src/lib/task-window.ts:165 (fetchRecentTaskIds via reconcileRecent :194) | /team-capacity | Id list when held+changed != count | Only on mismatch (deleted/aged-out task) | tasks id | Occasional | one id per windowed task | NOLIM, RT |
| C-139 | HEAD | tasks count older-completed | src/lib/task-window.ts:326; caller team-capacity.tsx:279 | /team-capacity (key capacity-tasks/older-count) | KPI total | Mount; refetched when scheduler invalidates prefix ["capacity-tasks"] (every task event, since the key is a child of capacity-tasks, team-capacity.tsx:320) | tasks | Per event | count | RT |
| C-140 | GET | `/rest/v1/tasks?select=*,worklogs&status=eq.Completed&or=<older>&assigned_to=eq` | src/lib/task-window.ts:89 (fetchOlderCompleted); caller team-capacity.tsx:864 | /team-capacity member history dialog | Older completed of one member | Dialog open | tasks | Per open | all older completed of one member, NOLIM | STAR, NOLIM |
| C-141 | GET | `/rest/v1/projects?select=id,name,client` | routes/_authenticated/time-tracking.tsx:81 | /time-tracking | Projects | Mount; staleTime 30 s; focus refetch ON (default) | projects | Per mount/focus after 30 s | all, NOLIM | NOLIM, DUP-of C-101 |
| C-142 | GET | `/rest/v1/tasks?select=<TIMESHEET_COLS>&order=created_at.desc` | routes/_authenticated/time-tracking.tsx:92 | /time-tracking | Timesheet | Mount; staleTime 10 s; refetchOnWindowFocus/reconnect default ON; no realtime | tasks, no filter | Per mount and per tab focus after 10 s | EVERY task row, NOLIM, Not measured | NOLIM, POLL-like (focus) |
| C-143 | GET | `/rest/v1/task_worklogs?select=<WORKLOG_TIMESHEET_COLS>&order=work_date.desc` | routes/_authenticated/time-tracking.tsx:93 | /time-tracking | Worklogs | same, parallel with C-142 | task_worklogs, no filter | same | EVERY worklog row, NOLIM | NOLIM |
| C-144 | GET | `/rest/v1/tasks?select=id,assigned_to,priority&status=eq.Completed&or=<older>` | src/lib/task-window.ts:102 (fetchOlderCompletedSummary) | none in src (only tests/internal) | Older-completed stubs | - | tasks | Not called | n/a | DEAD, NOLIM |
| C-145 | HEAD | tasks counts (2 + 2 x priorities) | src/lib/task-window.ts:128 (fetchOlderCompletedCounts) | none in src | Counts | - | tasks | Not called | n/a | DEAD |
| C-146 | GET | tasks `id` older completed | src/lib/task-window.ts:155 (fetchOlderCompletedIds) | none in src | ids | - | tasks | Not called | n/a | DEAD, NOLIM |
| C-147 | GET | tasks `updated_at` count + limit 1 | src/lib/task-window.ts:224 (probeOlderCompleted) | none in src | probe | - | tasks | Not called | n/a | DEAD |
| C-148 | GET | tasks `*,worklogs` helper fetchRecentTasksSince variants | src/lib/task-window.ts:204-216 | only via refreshRecentTasks (counted as C-136) | - | - | - | - | - | (same as C-136, not counted separately) |

Note: C-148 is a pointer row, excluded from totals. Heatmap route (routes/_authenticated/heatmap.tsx) is entirely commented out (`export {}`), so its tasks read (line 32) and workloadService.last7Days make no calls; excluded.
Server-fn only pages (no PostgREST/fetch from browser code; covered by the other agent): leaves, reviews (queue), notifications route, settings.operations, eod-tasks, sync, settings pages other than operations, forecast, reports, templates and others.

### 2. Per-page grouping

### Global / shell (inherited by every route under `_authenticated`, i.e. all pages except /login, `/`, public)
Mounted by `routes/_authenticated.tsx:107-115` (NotificationsProvider > AppShell > Outlet + UnstartedTaskLeaveModal + MorningResumePromptModal):
- Auth: C-001 (every full load), C-002 (60 s timer), C-005 (once per session), C-003 (native resume). /login: C-004, C-006.
- AppShell: C-013 (own profile, effect deps `[user]` so repeats on each token refresh); HolidayBanner: C-008 (+ serverFn fetchActiveAnnouncements, HolidayBanner.tsx:67, + holidaysService.list); NotificationsProvider: C-014 on mount, C-015..C-019 when panel/inbox opened or resynced; SyncStatusBadge/useOnlineSync: C-047..C-050 only if offline queue non-empty (drain on mount, focus, online); useNativeApp: C-003 + registerDeviceTokenFn.
- MorningResumePromptModal: C-013 (shared), C-020, C-021 each page load until the daily prompt key is set; also a Socket.IO channel (no HTTP).
- UnstartedTaskLeaveModal: serverFn leavesService.checkUnstartedTasksToday (UnstartedTaskLeaveModal.tsx:31) once per layout mount unless dismissed this session.
- Layout role gate: serverFn getMyRoles via getRolesShared(userId, 0) on every pathname change (_authenticated.tsx:69), plus again per token refresh (use-auth.ts:89-92).
- GlobalSearchModal (open only): C-023 (empty query) / C-028 (typed), C-024, C-025, C-026, C-027.
- TaskFormDialog (AppShell.tsx:798, open only): C-029, C-022, C-033, C-034 (fallback), C-008, C-030/C-031 on save, C-007 for attachments, C-032 on conflict.
- Realtime subscriptions in shell (Socket.IO, not HTTP): use-review-decisions realtime (AppShell.tsx:107), useMyDayFreshness (AppShell.tsx:112), notifications events, Morning modal channel.

### Per page
- `/` : C-078.
- /login : C-004, C-006.
- /my-day : C-013(shared), C-022 (via my-day-people query, 4 min), C-115, C-116..C-120 (tasks window + delta), serverFn getMyDay (my-day.tsx:294). MyTodayWorkSummaryCard C-044 not fired. Realtime: tasks (assignee scope) -> 250 ms debounce -> C-117/C-118/(C-119)/C-120; risk_events + approval_requests -> getMyDay 800 ms debounce.
- /tasks : C-022, C-122, C-123, C-124, C-125, C-126 (managers) or C-127 (members), C-128, C-129; CSVImportDialog: C-042, C-043; TaskCard children: C-035..C-038 (history), C-020; TaskDetailModal; realtime: tasks.
- /blockers : C-022, C-089 (reload on every task event).
- /calendar : C-022, C-092/C-093/C-094 (month range, delta), C-090, C-091, C-008, LeaveDialog C-039, serverFns leaves/holidays; realtime tasks + leaves.
- /command : C-022, C-092/C-093/C-094 (all tasks), C-012, SuggestionsPanel C-011, C-045, TomorrowRiskPanel C-046; serverFns risksService.listOpen (also on risk_events realtime), workSettingsService.get; realtime tasks (manager only) and risk_events.
- /dashboard : C-022, C-092/C-093/C-094, C-095 (every refresh); realtime tasks.
- /eod : C-023, C-092/C-093/C-094 (window), C-096, C-097, C-098, C-092 (snapshot click, all tasks); serverFn eodService.listForDate (also on eod_checkins realtime); realtime tasks.
- /executive : C-023, C-092/C-093/C-094 (range+scope), C-099, C-100, C-101, C-102, C-092 (export click); serverFns getExecScope, getExecSummary (re-run after every tasks event, 1 s debounce, executive.tsx:306), leavesService.getLeaves.
- /exports : C-103..C-113 (+ serverFns for the report).
- /intelligence : C-022, C-114 + serverFns intelligenceService.load, adoptionService.last14.
- /manager : serverFn getManagerCommand only (refetch on tasks, risk_events, approval_requests events, uncoalesced beyond 250 ms channel throttle, manager.tsx:28-34).
- /planning : C-022, C-121, C-125 (bulk).
- /planning-suggestions : C-022, C-045, C-046, C-011.
- /reviews : C-022 + serverFn reviewsService.queue (reloaded on tasks AND task_review_decisions events, reviews.tsx:57,61).
- /team-capacity : C-130..C-139, C-140 (dialog), C-125 (reconcile), leaves serverFn.
- /time-tracking : C-022, C-141, C-142, C-143.
- /workload : C-022, C-092/C-093/C-094.
- /analytics : C-085..C-088.
- /admin : C-079 (guard), C-083, C-084 (+ serverFns).
- /configure : C-080, C-058..C-072 (writes), C-062, C-066 (+ UserPicker -> C-022); rule editor C-051..C-057.
- /configure/new : C-081, C-073..C-077.
- /onboarding : C-082 (+ serverFns).
- /eod-tasks, /leaves, /settings/operations, /notifications, /sync, /forecast etc.: no PostgREST from browser code; shell items only (C-015.. for /notifications).

### 2b. Client call-sites of server functions (short, not exhaustive)

| file:line | serverFn | Trigger |
|---|---|---|
| src/hooks/use-auth.ts:43,53 / routes/_authenticated.tsx:69 | getMyRoles | every pathname change (maxAge 0), per token refresh, role TTL 60 s |
| src/components/HolidayBanner.tsx:67 | fetchActiveAnnouncements | shell mount |
| src/hooks/use-notifications.tsx:417,431 | markNotificationRead / markAllNotificationsRead | click |
| src/components/AppShell.tsx:250 | unregisterDeviceToken | logout |
| src/hooks/use-native-app.ts:29 | registerDeviceToken | native push token |
| src/components/UnstartedTaskLeaveModal.tsx:31 | leavesService.checkUnstartedTasksToday | layout mount |
| src/routes/_authenticated/my-day.tsx:144,298 | getMyDay | mount, focus (stale 2 min), 800 ms-debounced realtime |
| src/routes/_authenticated/executive.tsx:175,280 | getExecScope, getExecSummary | mount; summary after tasks events (1 s) |
| src/routes/_authenticated/manager.tsx:19,22 | getManagerCommand | mount, realtime |
| src/lib/task-form-options.ts:90 | fetchTaskNameHintsFn | TaskFormDialog open (5 min cache) |
| src/integrations/backend/storage.ts:109,123 | getDownloadUrlFn / deleteObjectsFn | attachment view / delete |
| src/hooks/use-review-decisions.ts:24 | reviewsService.listForTask | In Review tasks, staleTime 10 s |

### 3. Findings

1. Forced Keycloak refresh on every page load. auth.ts:67-73 passes saved `token`+`refreshToken` with `checkLoginIframe:false`; keycloak-js 24.0.5 then calls `kc.updateToken(-1)` (node_modules/keycloak-js/dist/keycloak.js:879), which always POSTs to the token endpoint even if the access token is valid (C-001). One extra token request per full load/reload.
2. Every `useAuth()` consumer subscribes to auth events; on each TOKEN_REFRESHED the shared roles cache is dropped and `getMyRoles` is called again (use-auth.ts:89-92), and every subscriber gets a new `user` object (auth.ts:98-99,113-114 builds a fresh object). Effects keyed on `[user]` re-run per token refresh: AppShell profile load (AppShell.tsx:199-225, C-013), MorningResumePromptModal (MorningResumePromptModal.tsx:135-162, C-013/C-020/C-021). The morning modal's once-per-day guard key is set only on dismiss/start/running-today (:52,:76,:165), so a user with no pending tasks re-runs C-020 + C-021 on each page load and each token refresh.
3. Role check duplicated: layout calls `getMyRoles` on every pathname change (_authenticated.tsx:69, maxAge 0) while `/`, /admin, /configure, /configure/new, /onboarding `beforeLoad` each run their own `user_roles` PostgREST read (C-078..C-082).
4. Unbounded "all rows" reads (no `.limit/.range`): time-tracking tasks + worklogs (C-142, C-143) with default focus refetch and staleTime 10 s and no realtime; dashboard/command/workload full task scans (C-092 full, repeated every 5 min via ALL_TASKS_FULL_RELOAD_MS task-window.ts:296,:310); planning (C-121) re-reads all open tasks on every task event without delta; blockers (C-089) `select *` on every event; CSV import dialog loads every task (C-043); team-capacity org-wide window (C-134).
5. Realtime-triggered refetch amplification (events scope "all", 250 ms throttle only): blockers C-089, planning C-121, dashboard C-092/C-095 (own channel, extra detail query loop), eod C-098 pages through every completed task's `assigned_to` (1000 per request) on each event in table view (eod.tsx:123, task-window.ts:489-504), tasks page counters up to 15 HEAD requests 1.2 s after each event (tasks.tsx:429, task-list-query.ts:218-292), calendar day panel re-reads `select *` for the day's ids on every tasks refresh while open (calendar.tsx:314 deps include `tasks`), team-capacity `older-count` HEAD (C-139) re-runs on every task event because its key is prefixed `capacity-tasks` and the scheduler invalidates that prefix.
6. Duplicate data across pages with separate query keys or no cache: profiles (C-083, C-103, C-130, C-039, C-066 vs shared people cache C-022/C-023), user_roles (C-084 vs C-131 vs getMyRoles), projects (C-101, C-133, C-141, C-105, C-033, C-096), teams (C-102, C-132, C-104), profile_emails (C-042 vs C-122), pending_review_assignments (C-088 vs C-114).
7. `select('*')` on wide tables: tasks (C-020, C-021, C-027, C-032, C-045, C-090, C-091, C-097, C-110, C-113, C-115, C-116, C-118, C-123, C-125, C-129, C-134, C-136, C-140, C-089), profiles (C-130), comments/task_history/carry_forward (C-029, C-035, C-036, C-038, C-087), daily_workload_snapshot (C-086), work_item_field_defs (C-062), eod_checkins (C-100).
8. N+1 / loops: TaskFormDialog.ensureMasterProject select+insert per project name (TaskFormDialog.tsx:686-701); configure.new publish wizard issues one POST per status/transition/field/step sequentially (configure.new.tsx:147-190); attachment uploads sequential per file (TaskFormDialog.tsx:712); exports "separate sheets" runs 4 queries per project in parallel (exports.tsx:332, fetchProjectActivity :962) and `task_worklogs.in(task_id, ALL project task ids)` with no chunking (exports.tsx:1024, risk of oversized URL); dashboard detail chunk loop awaited sequentially per refresh (dashboard.tsx:39-42); PhotoField/SignatureField do one attachments read per field mount (C-040, C-041).
9. Dead/unnecessary: C-010 nudges generateNow (no caller; NudgeCenter not mounted), C-044 summary-card self-fetch (never fires because my-day passes `allTasks`), C-144..C-147 helper fetchers with no src caller, heatmap route commented out. These add no traffic but are maintenance risk.
10. Request cost controls that work (positive): notifications use HEAD count + 24 h window + limit 50 and are coalesced (use-notifications.tsx:107-117); people/profile/roles/options caches; delta refresh pattern (loadAllTasksSlim, refreshMyTasksWithWorklogs, refreshRecentTasks); task search debounce 120 ms and 5 s reuse; tasks page limited to 50 rows; no refetchInterval anywhere.
11. Default react-query behavior left on for time-tracking (3 queries) and my-day queries (focus refetch): any tab focus after staleTime refetches (C-116 family and C-142/C-143). `defaultOptions` sets only retry (router.tsx:8).
12. Auth interval (auth.ts:107) is created inside `.then` after init and never cleared; guarded by `initPromise`, so one instance. Request volume depends on token lifetime (Not measured); `expires_in: 43200` in the synthetic session (auth.ts:137) is not the real lifetime.
13. Every PostgREST request sends `Cache-Control: no-cache, no-store` and `Expires: 0` (supabase/client.ts:51-70), so browser/proxy caching of GETs is disabled by design; combined with the above, repeated identical GETs always hit the server.

### 4. Totals

Counts are call-site rows (distinct code locations/query shapes), not request instances. C-148 is a pointer row and excluded.

| Type | Count | IDs / note |
|---|---|---|
| Total call-site rows | 147 | C-001..C-147 |
| PostgREST total | 136 | |
| - GET (`/rest/v1/<table>`) | 100 | |
| - HEAD (count-only) | 12 | C-014, C-018, C-026, C-051, C-052, C-094, C-117, C-120, C-126, C-135, C-139, C-145 |
| - RPC (`/rest/v1/rpc/*`) | 1 | C-005 ensure_user_profile (the only browser `supabase.rpc`) |
| - POST (insert) | 14 | C-031, C-047, C-049, C-050, C-060, C-061, C-065, C-069, C-071, C-073..C-077 |
| - PATCH (update) | 5 | C-048, C-063, C-064, C-068, C-072 |
| - DELETE | 4 | C-058, C-059, C-067, C-070 |
| Keycloak token POST | 4 | C-001, C-002, C-003, C-004 |
| Keycloak redirects (NAV) | 1 | C-006 |
| `/app-storage/upload` POST | 1 | C-007 |
| `/api/public/hooks/*` POST | 3 | C-010 (no caller), C-011, C-012 |
| Third-party GET (date.nager.at) | 1 | C-008 |
| Local fetch(blob/url) GET | 1 | C-009 |
| Timer-driven (POLL) network | 1 | C-002 (60 s interval; request only near expiry). No `refetchInterval` anywhere |
| useQuery sites on default focus/reconnect refetch | 5 | time-tracking.tsx:71,78,88; my-day.tsx:248,294 (use-review-decisions.ts:19 and executive.tsx:176 are server-fn queries with their own staleTime) |
| DEAD / no caller | 6 | C-010, C-044, C-144, C-145, C-146, C-147 |
| Rows flagged STAR | 30 | by Flags column |
| Rows flagged NOLIM | 40 | by Flags column |
| Rows flagged RT (refetch on realtime event) | 29 | by Flags column |
| Raw `fetch(` call sites in browser-reachable code | 7 | auth.ts:197, storage.ts:86, format.ts:287, AppShell.tsx:161, nudges.ts:18, planning-suggestions.ts:24, risks.ts:33 (email-dispatcher.ts:34,93,263 are server-only: imported only by *.server.ts, *.functions.ts and api routes) |
| `supabase.rpc` in browser code | 1 | auth.ts:42 |


---

# Part B — Server functions and HTTP route handlers


Scope: `C:\Users\sumit\Downloads\Daily Flow Postgres` (branch fix/api_call_pattern_changed, working tree as of audit). Read-only, code-derived. No metrics were measured; where a number is not visible in code it is written "Not measured".

### 0. Method, notation and global facts

- Discovery: `grep -rn createServerFn src` returns 187 lines = 144 `createServerFn(` call sites + 42 `import` lines + 1 README mention (src/integrations/postgres/README.md:43). Of the 144 call sites, 1 is commented out (`last7DaysWorkloadFn`, src/services/workload.functions.ts:57) => **143 live server functions** (51 GET, 92 POST). No `createServerFn` exists in route files (src/routes/**) or src/routes/api; routes only contain `createFileRoute(...).server.handlers` (see section 1B). Files: 35 under src/services/*.functions.ts, src/lib/{admin-actions,executive.functions,forecast.functions,manager.functions,my-day.functions,qa-seed.functions}.ts, src/integrations/backend/storage.ts. (src/services/auth.functions.ts contains no serverFn - `getMyRoles` is a plain client function.)
- Middleware: **all 143** use `.middleware([requireSupabaseAuth])` (src/integrations/supabase/auth-middleware.ts): requires `Authorization: Bearer`, verifies JWT with `verifyBackendJwt`, injects `{supabase (PostgREST client carrying the user JWT), userId, claims}`. It authenticates only; role checks exist only inside some handlers (e.g. announcements, admin-actions, listReviewQueueFn scope=all, leaves). Several handlers use `adminQuery/adminSelect/supabaseAdmin/getPool().query` (RLS bypass) - flagged per row.
- HTTP/endpoint: TanStack Start serverFns are served at `/_serverFn/<id>`; GET sends the payload in the query string, POST in the body. The id is a build-time 64-hex hash. It is taken from the manifest in `dist/server/assets/server-CdoVjvEL.js` (build dated 2026-10-28, OLDER than current src): 133 of the 143 ids are present there (the manifest has 134 entries; see 1A); the 10 not in that build are marked "not in dist build" (generated `/_serverFn/<sha256 hash>`). Ids can differ if the build is regenerated; function name + file are the stable keys. Full ids are in section 1A.
- SQL-count notation: `N+5tx` = N handler statements plus 5 statements added by `withUser()` (src/integrations/postgres/query.server.ts: BEGIN, `set_config(request.jwt.claim.sub)`, `set_config(request.jwt.claims)`, `SET LOCAL role`, COMMIT). `selectAsUser` = 1+5tx. `adminQuery/adminSelect/pool.query` = no tx wrapper. "PostgREST HTTP calls" = `context.supabase.from()/rpc()` calls, each one HTTP request from the Node server to SUPABASE_URL (Caddy -> postgrest, infra/Caddyfile:2-4) and one SQL execution inside PostgREST. `Promise.all` of `client.query` on a single pg client is NOT parallel: pg queues them on one connection (serial).
- Trigger legend: mount = useEffect on component mount; click = user event; open = dialog/sheet opened; RT = Socket.IO realtime event (src/integrations/realtime/channel.ts: events coalesced leading+trailing with THROTTLE_MS=250, line 51; callbacks also run once on reconnect / when a hidden tab returns, src/hooks/use-realtime-refresh.ts doc + channel.ts:197). There is **no `refetchInterval` and no client `setInterval` that calls a server function** anywhere in src (grep). Only the server-side 60 s cron ticker (src/lib/cron-ticker.server.ts) and a safety refresh while the socket is disconnected (socket.ts:67-80) are timed.
- React Query: only 9 files use it. Query defaults: `realtimeCovered()` staleTime 30 s (smart-query.ts:26-29, no focus/reconnect refetch), `slowChanging()` 5 min (smart-query.ts:24). All other serverFn calls are plain `useEffect` + `useState` with **no client cache** (the only caches: task-form-options.ts 5 min / leaves 60 s, notesStore guard).
- Frequency in this document is derived only from trigger code (mount/click/RT/stale times). Absolute call volumes and payload sizes are "Not measured".

### 1. Master table of server functions

Columns: ID | function | method + endpoint (id8 = first 8 hex of `/_serverFn/<id>`) | file:line (definition) | purpose | tables R/W | SQL statements per invocation (code-derived) | LIMIT / data size | client call-sites (file:line, trigger, cache) | flags. Middleware for every row = `requireSupabaseAuth`.

| ID | Function | Method / endpoint | file:line | Purpose | Tables (R/W) | SQL per call | LIMIT / size | Client call-sites + trigger + cache | Flags |
|---|---|---|---|---|---|---|---|---|---|
| S-001 | getDownloadUrlFn | POST /_serverFn/354edeed… | integrations/backend/storage.ts:18 | Mint HMAC-signed /app-storage/file URL (self mode) or Supabase signed URL | none (HMAC compute only; no SQL) | 0 | n/a | via attachmentsService.download (services/attachments.ts:74 -> integrations/backend/storage.ts:109): AttachmentsPanel.tsx:72 (click), TaskDetailModal.tsx:834 (click), PhotoField.tsx:42 + SignatureField.tsx:29 (effect on mount/value change, one call per field that has an attachment, plus 1 PostgREST attachments read each) | No client cache; 1 call per download/preview/field render |
| S-002 | deleteObjectsFn | POST /_serverFn/8d618255… | integrations/backend/storage.ts:47 | Delete attachment rows by storage_path (self mode) or Supabase Storage objects | W attachments (self mode) | 1 (adminQuery, pool.query, no tx) | ANY($1) list | storage.ts:121 via attachments.ts:68 (rollback of failed upload), attachments.ts:82 (remove, AFTER deleteAttachmentMetaFn already deleted same row), lib/offline-queue.ts:203 (offline photo queue rollback) | REDUNDANT on remove: row already deleted by deleteAttachmentMetaFn; also bypasses RLS (adminQuery) with no ownership check |
| S-003 | deleteUser | POST /_serverFn/c5ad5da5… | lib/admin-actions.ts:5 | Admin: hard-delete a user and dependent rows | R user_roles; W approval_decisions, eod_checkins, daily_workload_snapshot, user_streaks, notification_prefs, adoption_daily, nudges, planning_suggestions(x3), comments, notifications, user_roles, user_org_roles, profiles, auth.users (+DDL: auth.uid(), public.log_task_change()) | 1 PostgREST role check + 2 DDL (CREATE OR REPLACE FUNCTION, pool.query, admin-actions.ts:33,53, run on EVERY call) + 10 service-role deletes + up to 4 further deletes (+4 fallback) + profiles delete + auth.admin.deleteUser = about 19-23 round trips | n/a | routes/_authenticated/admin.tsx:68 (hook), :154 (click Delete user) | Many sequential DB calls per invocation; runs DDL on every call |
| S-004 | updateUserAdminSettings | POST /_serverFn/a25c819f… | lib/admin-actions.ts:263 | Admin: change a user's manager and/or role | R user_roles; W profiles, user_roles | up to 5 on 1 pool client: BEGIN, admin check, UPDATE profiles, DELETE user_roles, INSERT user_roles, COMMIT (6 incl. COMMIT, no RLS wrapper) | n/a | admin.tsx:69 (hook), :119 (click: role/manager change) | - |
| S-005 | getExecSummary | POST /_serverFn/5ea2b6bb… | lib/executive.functions.ts:13 | Executive dashboard rollup via DB function exec_summary() | R (inside exec_summary, SECURITY DEFINER): tasks, profiles, teams, projects, risk_events, approval_requests, eod_checkins, automation_runs, automation_rules, automation_queue_stats, adoption_daily, carry_forward_events, work_settings, work_item_types, user_roles/has_role | 1 PostgREST RPC (1 HTTP call to PostgREST); internal SQL of the function: Not measured | days max 90 (zod); function-side limits: Not measured | executive.tsx:283 (useQuery key [exec-summary,range,scope,projects,types], enabled when scope resolved, realtimeCovered => staleTime 30s, no focus/reconnect refetch, no refetchInterval); realtime refetch: executive.tsx:303-311 useRealtimeRefresh(['tasks']) -> refresh.schedule(['exec-summary'],1000) | HIGH-TRAFFIC: re-run on every (coalesced) org-wide tasks event while page open; also on reconnect/visible-return (use-realtime-refresh) |
| S-006 | getExecScope | GET /_serverFn/dfd023c8… | lib/executive.functions.ts:41 | Resolve caller's default executive scope (admin/manager/team) | R profiles, user_roles, teams | 2 parallel PostgREST + 1 conditional (teams) = 2-3 HTTP calls | single-row filters | executive.tsx:178 (useQuery key [exec-scope-bootstrap], staleTime Infinity, mount) | once per session |
| S-007 | getForecast | GET /_serverFn/0e7b5122… | lib/forecast.functions.ts:222 | Manager forecast: SLA breach, capacity, approval bottleneck, project outlook | R profiles, user_roles, work_settings, projects, risk_events, approval_requests, approval_steps, tasks | 11 PostgREST HTTP calls (2 + 8 parallel + 1 conditional tasks); no tx | NO LIMIT on: projects, risk_events (all open), approval_requests (all), approval_steps (all), scoped tasks(.in assigned_to members; all statuses). LIMIT 1000 recent approvals, LIMIT 2000 completed tasks (30d) | forecast.tsx:42 (useEffect on mount, plain useState, no react-query cache, no realtime) | Heavy unbounded reads; re-run on every visit of /forecast |
| S-008 | getManagerCommand | GET /_serverFn/7ddf4cd3… | lib/manager.functions.ts:123 | Manager command center payload (KPIs, capacity, at-risk, approvals, projects) | R profiles, user_roles, work_settings, projects, risk_events, approval_requests, approval_steps, tasks | 10 PostgREST HTTP calls (2 + 7 parallel + 1 conditional tasks); no tx | NO LIMIT on projects, risk_events (all open), approval_requests (all), approval_steps (all), scoped tasks (all statuses of all members); LIMIT 500 recent non-pending approvals | manager.tsx:22 (useQuery key [manager-command], staleTime 30s, refetchOnWindowFocus false); realtime refetch manager.tsx:28-33 useRealtimeRefresh(['tasks','risk_events','approval_requests']) -> q.refetch() (no extra debounce beyond 250ms channel throttle) | HIGH-TRAFFIC: re-run (10 HTTP calls) on every tasks/risk/approval event; heavy unbounded reads |
| S-009 | getMyDay | GET /_serverFn/2e23b265… | lib/my-day.functions.ts:87 | My Day payload (scored tasks, approvals pending for me, capacity) | R task_reviewers, tasks, work_settings, approval_requests, risk_events, approval_steps, user_roles | 4 base PostgREST calls + ceil(n_tasks/100) risk chunks (0-4) + 2 conditional (approval_steps, user_roles when any pending request) = 4-10 HTTP calls | tasks LIMIT 400; approval_requests (all pending, no LIMIT); risk chunks of 100 ids | my-day.tsx:298 (useQuery key [MY_DAY_KEY,userId], staleTime 2 min (my-day-cache.ts:26), refetchOnWindowFocus true); realtime: my-day.tsx:311-318 refetch debounced 800ms from useRealtimeTasks (assignee scope, my-day.tsx:352), useRealtimeRefresh(['risk_events','approval_requests']) my-day.tsx:344, handleRealtimeChange from many child components (my-day.tsx:587-911) | HIGH-TRAFFIC: refetch per task/risk/approval event (800ms debounce) + on window focus when stale |
| S-010 | seedQaAccounts | POST /_serverFn/n/a (generated /_serverFn/<sha256>, not in dist build) | lib/qa-seed.functions.ts:22 | Seed 3 QA accounts (admin only) | R user_roles; W user_roles, profiles, auth users | ~2 + 3x(create/update user, role upsert, profile upsert) | n/a | NO client call-site found | UNUSED from client; contains hard-coded QA passwords (lib/qa-seed.functions.ts:34-37) |
| S-011 | fetchAdoptionLast14 | GET /_serverFn/cbd088c0… | services/adoption.functions.ts:7 | Adoption rollup rows since date | R adoption_daily | 1+5tx (selectAsUser) | date >= $1 (sinceISO); NO LIMIT; row count Not measured | via adoptionService.last14 (services/adoption.ts:8): intelligence.tsx:42 (mount) | once per Intelligence page mount |
| S-012 | fetchActiveAnnouncements | GET /_serverFn/06191a7c… | services/announcements.functions.ts:6 | Active announcements for today | R announcements | 1+5tx (selectAsUser) | date-bounded, NO LIMIT | components/HolidayBanner.tsx:55 (hook), :67 (effect, mount of AppShell) | Global/shell: every AppShell mount (once per page load / login); no cache |
| S-013 | fetchAllAnnouncements | GET /_serverFn/895f75c6… | services/announcements.functions.ts:21 | Admin: all announcements | R announcements | 1+5tx (selectAsUser) | NO LIMIT, NO WHERE | admin.tsx:70 (hook), :99 (loadAnnouncements, mount at :26-27 and after create/delete) | - |
| S-014 | createAnnouncement | POST /_serverFn/1c6d53ef… | services/announcements.functions.ts:32 | Admin: create announcement | R user_roles; W announcements | 2 statements in 2 transactions: (1+5tx)+(1+5tx) | n/a | admin.tsx:174 (click) | - |
| S-015 | deleteAnnouncement | POST /_serverFn/6b15bd45… | services/announcements.functions.ts:74 | Admin: delete announcement | R user_roles; W announcements | 2 statements in 2 transactions | n/a | admin.tsx:207 (click) | - |
| S-016 | listChainsForTypeFn | GET /_serverFn/5e0e1a8a… | services/approvals.functions.ts:15 | Approval chains of a work-item type | R approval_chains | 1+5tx | WHERE type_id; no LIMIT | via approvalsService.listChainsForType (services/approvals.ts:54): configure/ApprovalsPanel.tsx:46 (effect on type change), configure/TypePreviewSheet.tsx:49 (sheet open) | - |
| S-017 | listApprovalStepsFn | GET /_serverFn/77d42dff… | services/approvals.functions.ts:34 | Steps of a chain | R approval_steps | 1+5tx | WHERE chain_id; no LIMIT | approvals.ts:58: ApprovalsPanel.tsx:58, TypePreviewSheet.tsx:51 (N+1: one call per chain inside Promise.all(cs.map)) | N+1 per chain in TypePreviewSheet |
| S-018 | startApprovalRequestFn | POST /_serverFn/41d93477… | services/approvals.functions.ts:52 | Create approval request | W approval_requests | 1+5tx | n/a | approvalsService.start (approvals.ts:65): NO caller | UNUSED from client |
| S-019 | decideApprovalFn | POST /_serverFn/3bba3335… | services/approvals.functions.ts:77 | Record approval decision | W approval_decisions | 1+5tx | n/a | approvalsService.decide (approvals.ts:76): NO caller | UNUSED from client |
| S-020 | listApprovalsForWorkItemFn | GET /_serverFn/f6417eb2… | services/approvals.functions.ts:116 | Approval requests of a work item | R approval_requests | 1+5tx | WHERE work_item_id; no LIMIT | approvalsService.listForWorkItem (approvals.ts:82): NO caller | UNUSED from client |
| S-021 | listAttachmentsFn | GET /_serverFn/dbc8f3d5… | services/attachments.functions.ts:13 | Attachments of a work item | R attachments | 1+5tx | WHERE work_item_id; no LIMIT | via attachmentsService.list (services/attachments.ts:38): AttachmentsPanel.tsx:42 (mount/open), TaskDetailModal.tsx:153 (only when modal open), TaskFormDialog.tsx:237 (form open with id) | Duplicate: TaskFormDialog:237 and its AttachmentsPanel (TaskFormDialog.tsx:2055) both list the same item's attachments when the edit form is open; same for TaskHistorySheet.tsx:233 |
| S-022 | insertAttachmentMetaFn | POST /_serverFn/095b86ae… | services/attachments.functions.ts:34 | Insert attachment metadata row (dedupe/claim existing) | R/W attachments | 1+5tx wrapper + 1-3 statements (SELECT existing, optional UPDATE uploaded_by, INSERT) | n/a | attachments.ts:56 (upload) via AttachmentsPanel.tsx:59, CommentsPanel.tsx:160, CompleteTaskEodDialog.tsx:131, TaskFormDialog.tsx:714, PhotoField.tsx:70, SignatureField.tsx:69 (each file in a loop/click); lib/offline-queue.ts:193 (queue replay) | one call per uploaded file |
| S-023 | deleteAttachmentMetaFn | POST /_serverFn/70b8ea99… | services/attachments.functions.ts:97 | Delete attachment row | W attachments | 1+5tx | n/a | attachments.ts:81 via AttachmentsPanel.tsx:87 (click) | followed by redundant deleteObjectsFn |
| S-024 | listAutomationRulesFn | GET /_serverFn/ddfb7eef… | services/automations.functions.ts:15 | List automation rules | R automation_rules | 1+5tx | NO LIMIT | automations.ts:62: RulesPanel.tsx:23 (mount + after each action), RunsTable.tsx:31 (mount, in Promise.all) | Duplicate: Rules tab and Runs tab both fetch the full rule list |
| S-025 | getAutomationRuleFn | GET /_serverFn/1e0bd557… | services/automations.functions.ts:29 | Get one rule | R automation_rules | 1+5tx | by id | automationsService.get (automations.ts:66): NO caller | UNUSED from client |
| S-026 | createAutomationRuleFn | POST /_serverFn/f99ba2b5… | services/automations.functions.ts:46 | Create rule | W automation_rules | 1+5tx | n/a | automations.ts:70 via RuleEditorDrawer.tsx:143 (click) | - |
| S-027 | updateAutomationRuleFn | POST /_serverFn/96a91249… | services/automations.functions.ts:73 | Update rule (also used to toggle active) | W automation_rules | 1+5tx | n/a | automations.ts:76 via RuleEditorDrawer.tsx:142, RulesPanel.tsx:27 (setActive, click) | - |
| S-028 | deleteAutomationRuleFn | POST /_serverFn/10b87f48… | services/automations.functions.ts:104 | Delete rule | W automation_rules | 1+5tx | n/a | automations.ts:89 via RulesPanel.tsx:32 (click) | - |
| S-029 | listAutomationRunsFn | GET /_serverFn/c8bf908a… | services/automations.functions.ts:119 | List automation runs | R automation_runs | 1+5tx | LIMIT $limit (default 100, zod max 1000) | automations.ts:95 via RunsTable.tsx:30 (mount + filter change, limit 100) | - |
| S-030 | replayAutomationRunFn | POST /_serverFn/c009f8c7… | services/automations.functions.ts:158 | Replay dead run via DB function automation_replay_dead_run() | W (inside function): automation_runs/events - Not measured | 1+5tx | n/a | automations.ts:99 via RunsTable.tsx:39 (click) | - |
| S-031 | automationHealthFn | GET /_serverFn/260eed3e… | services/automations.functions.ts:173 | Automation health counters | R automation_queue_stats, automation_rules, automation_runs | 5+5tx (5 queries in Promise.all on ONE pg client: they execute serially on that connection) | automation_rules: NO LIMIT/WHERE; runs: 24h window COUNT | automations.ts:103 via automation/HealthPanel.tsx:16 (mount; refetched on socket event automation:health HealthPanel.tsx:22, on resync HealthPanel.tsx:23-25, and on the shared backed-off safety refresh only while socket is disconnected HealthPanel.tsx:26) | - |
| S-032 | carryTaskForwardFn | POST /_serverFn/8818b17b… | services/carry-forward.functions.ts:8 | Carry task to a date via DB function carry_task_forward() | W (inside function) tasks, carry_forward_events, task_history - Not measured | 1+5tx | n/a | carry-forward.ts:25: SuggestionsPanel.tsx:69, planning.tsx:95 (loop per selected task), eod.tsx via carryAllOverdue (loop per overdue task per person) | N calls for bulk carry (sequential loop in planning.tsx:94-96 and carry-forward.ts:52-62) |
| S-033 | carryForwardWithTimerFn | POST /_serverFn/8fc8146a… | services/carry-forward.functions.ts:43 | Carry forward while stopping timer (bank hours) | R/W tasks, task_worklogs; W carry_forward_events | ~5-9 statements: SELECT FOR UPDATE, bankTimer (SAVEPOINT, SELECT segments, optional SELECT CURRENT_DATE, INSERT per day-part, RELEASE), UPDATE tasks, INSERT carry_forward_events, +5tx | n/a | carry-forward.ts:37 via TaskCard.tsx:244 (click) | - |
| S-034 | listOverdueForUserFn | GET /_serverFn/654c17ae… | services/carry-forward.functions.ts:109 | Overdue open tasks of a user (SELECT *) | R tasks | 1+5tx | WHERE assigned_to, status<>Completed, due_date<today; NO LIMIT; SELECT * (all columns) | carry-forward.ts:48 via EodCheckInSheet.tsx:76 (click), eod.tsx:234 (loop over ALL profiles) and :249 (click) | N+1: eod.tsx:232-236 runs this once per profile, sequentially, then one carry per task |
| S-035 | listCarryEventsForTaskFn | GET /_serverFn/fab75e53… | services/carry-forward.functions.ts:129 | Carry events of a task | R carry_forward_events | 1+5tx | WHERE task_id; no LIMIT | carryForwardService.listForTask (carry-forward.ts:69): NO caller in src (tests only) | UNUSED from client |
| S-036 | listCommentsFn | POST /_serverFn/df7b1cbf… | services/comments.functions.ts:23 | Comments (with mentions) of a work item | R comments, comment_mentions | 1+5tx (mentions via correlated sub-select) | WHERE work_item_id; no LIMIT | comments.ts:27 via CommentsPanel.tsx:59 (mount; reload after add/edit/remove), hosted by TaskDetailModal.tsx:860, TaskFormDialog.tsx:2050, TaskHistorySheet.tsx:229 | - |
| S-037 | listMentionableUsersFn | POST /_serverFn/fa0d7f1e… | services/comments.functions.ts:55 | All active profiles for @mention | R profiles | 1 (adminSelect, pool.query, bypasses RLS, no tx) | NO LIMIT; every active user (id, display_name, email, avatar) | comments.ts:31 via CommentsPanel.tsx:71 (mount of EVERY CommentsPanel instance) | Duplicate/unbounded: same global list re-fetched per CommentsPanel mount (no cache); returns emails of all users to any authenticated user |
| S-038 | addCommentFn | POST /_serverFn/82ab8a28… | services/comments.functions.ts:86 | Add comment + mentions | R comments, profiles; W comments, comment_mentions | 3-4 +5tx (optional parent check, INSERT comment, validMentionIds SELECT, INSERT mentions) | n/a | comments.ts:45 via CommentsPanel.tsx:140 (click) | - |
| S-039 | editCommentFn | POST /_serverFn/149593ae… | services/comments.functions.ts:142 | Edit comment + replace mentions | W comments, comment_mentions; R profiles | 4 +5tx (UPDATE, validMentionIds, DELETE mentions, INSERT mentions) | n/a | comments.ts:57 via CommentsPanel.tsx:189 (click) | - |
| S-040 | removeCommentFn | POST /_serverFn/b9faa03d… | services/comments.functions.ts:182 | Soft-remove comment | W comments | 1-2 +5tx | n/a | comments.ts:61 via CommentsPanel.tsx:203 (click) | - |
| S-041 | fetchCurrentConfigFn | GET /_serverFn/7c5970b9… | services/config-io.functions.ts:9 | Export entire workflow config | R work_item_types, work_item_statuses, work_item_transitions, work_item_field_defs, approval_chains, approval_steps, org_roles, org_role_hierarchy | 8+5tx (8 SELECT * in Promise.all on one pg client => serial) | NO LIMIT, SELECT * on 8 tables | config-io.ts:34 (export; ImportExportPanel.tsx:18 click), config-io.ts:55 (previewImport; ImportExportPanel.tsx:27 click) | - |
| S-042 | importConfigFn | POST /_serverFn/afbcac49… | services/config-io.functions.ts:41 | Import config (upserts) | W org_roles, work_item_types, work_item_statuses, work_item_field_defs, work_item_transitions; snapshot_config() writes config_snapshots | 1 snapshot + per-row upsert loops: 1 + #roles + #types + #statuses + #fields + #transitions (+ lookups) +5tx (sequential awaits in for loops, config-io.functions.ts:63-190) | payload size bound: Not measured | config-io.ts:77 via ImportExportPanel.tsx:39 (click) | Loop: one statement per config row (N+1 style, single tx) |
| S-043 | listConfigSnapshotsFn | GET /_serverFn/c1b0e090… | services/config-snapshots.functions.ts:10 | List config snapshots | R config_snapshots | 1+5tx | LIMIT 50 | config-snapshots.ts:19 via VersionsPanel.tsx:27 (mount + after action) | - |
| S-044 | snapshotConfigFn | POST /_serverFn/5428a74b… | services/config-snapshots.functions.ts:25 | Create snapshot via DB function snapshot_config() | W config_snapshots (inside function) | 1+5tx | n/a | config-snapshots.ts:26 via VersionsPanel.tsx:35 (click) | - |
| S-045 | restoreConfigFn | POST /_serverFn/827aa6cd… | services/config-snapshots.functions.ts:44 | Restore config via restore_config() | W config tables (inside function) - Not measured | 1+5tx | n/a | config-snapshots.ts:31 via VersionsPanel.tsx:42 (click) | - |
| S-046 | deleteConfigSnapshotFn | POST /_serverFn/5f83fd36… | services/config-snapshots.functions.ts:56 | Delete snapshot | W config_snapshots | 1+5tx | n/a | config-snapshots.ts:47 via VersionsPanel.tsx:49 (click) | - |
| S-047 | submitDemoFeedback | POST /_serverFn/d97634f2… | services/demo-feedback.functions.ts:24 | Store demo feedback | W demo_feedback_logs (+DDL CREATE TABLE IF NOT EXISTS) | 1 DDL (adminQuery, EVERY call) + 1+5tx | n/a | components/GlobalFeedbackWidget.tsx:14 (hook, click submit; AppShell.tsx:785), components/InteractiveFigmaDemoModal.tsx:57 (click) | Runs CREATE TABLE IF NOT EXISTS on every call (demo-feedback.functions.ts:30) |
| S-048 | fetchDemoFeedbackStats | GET /_serverFn/47e1065e… | services/demo-feedback.functions.ts:87 | All demo feedback rows + stats | R demo_feedback_logs | 1 (adminSelect, no tx) | NO LIMIT, NO WHERE (all rows); no admin check in handler | components/DemoFeedbackDashboard.tsx:19 (hook), :22 (loadFeedbackData, effect/mount in admin.tsx:573) | Unbounded read; any authenticated user can call |
| S-049 | clearAllDemoFeedback | POST /_serverFn/31b6796d… | services/demo-feedback.functions.ts:134 | TRUNCATE demo_feedback_logs | W demo_feedback_logs | 1 (adminQuery) | n/a | NO client call-site | UNUSED from client; no admin check in handler |
| S-050 | registerDeviceTokenFn | POST /_serverFn/5c340be7… | services/device-tokens.functions.ts:14 | Register FCM device token | W device_tokens (+DDL CREATE TABLE once/process) | ensure(0-1 DDL) + 1 DELETE (pool) + 1+5tx upsert | n/a | hooks/use-native-app.ts:29 (onPushToken callback, native app only; AppShell.tsx:244) | per push-token event (native app) |
| S-051 | unregisterDeviceTokenFn | POST /_serverFn/b75dc29b… | services/device-tokens.functions.ts:49 | Remove FCM device token | W device_tokens | ensure(0-1 DDL) + 1+5tx | n/a | AppShell.tsx:250 (click: logout) | - |
| S-052 | listFieldDefsFn | GET /_serverFn/8711faab… | services/dynamic-fields.functions.ts:7 | Custom field defs of a type | R work_item_field_defs | 1+5tx | WHERE type_id; no LIMIT | via dynamicFieldsService.listDefs (services/dynamic-fields.ts:39): TaskFormDialog.tsx:530 (effect on form open/type change; global dialog in AppShell.tsx:798), configure/ApprovalsPanel.tsx:47, WorkflowPanel.tsx:40, TypePreviewSheet.tsx:46 | Duplicate with WorkflowPanel/TypesPanel flows for same type (no cache) |
| S-053 | getEodTodayFn | GET /_serverFn/9d9defbd… | services/eod.functions.ts:11 | Today's EOD check-in for user | R eod_checkins | 1+5tx | 1 row | via eodService.getToday (services/eod.ts:11): components/EodReminder.tsx:20 (effect, mounted from my-day.tsx:726) | once per My Day mount (+ per userId change) |
| S-054 | upsertEodFn | POST /_serverFn/9d414ae9… | services/eod.functions.ts:29 | Upsert EOD check-in | W eod_checkins | 1+5tx | n/a | eod.ts:18 via EodCheckInSheet.tsx:65 (click) | - |
| S-055 | listEodForDateFn | GET /_serverFn/35355345… | services/eod.functions.ts:79 | EOD check-ins of a date (manager) | R eod_checkins | 1+5tx | WHERE checkin_date; no LIMIT | via eodService.listForDate (services/eod.ts:24): routes/_authenticated/eod.tsx:85 (mount/load), :136 (RT: useRealtimeRefresh(['eod_checkins'])) | RT-driven |
| S-056 | buildExportRowsFn | POST /_serverFn/cf0b3b8c… | services/exports.functions.ts:27 | Build export rows (7 optional queries) | R task_history, adoption_daily, carry_forward_events, tasks, daily_workload_snapshot, eod_checkins | up to 7+5tx (loop over requested kinds) | date ranges; NO LIMIT | NO client call-site | UNUSED from client |
| S-057 | recordExportFn | POST /_serverFn/5c43050f… | services/exports.functions.ts:143 | Record export audit | W via DB function record_export() (exports.functions.ts:163); tables inside: Not measured | 1+5tx | n/a | NO client call-site | UNUSED from client |
| S-058 | getMonthlyCapacityReportFn | POST /_serverFn/47a92403… | services/exports.functions.ts:209 | Monthly capacity report | R projects, tasks, work_settings, holiday_calendar, profiles, task_eod_submissions, leaves (adminSelect) | 7 queries (216, 254, 259, 295, 341, 381, 404-414) +5tx; +1 throttled promoteDueTentativeLeaves UPDATE (60s) | date range filters; NO LIMIT on tasks/profiles | exports.ts:348 via routes/_authenticated/exports.tsx:258 (click Generate) | - |
| S-059 | fetchIntelligenceBundle | GET /_serverFn/9ece234f… | services/intelligence.functions.ts:21 | Intelligence page bundle | R tasks, risk_events, daily_workload_snapshot, adoption_daily, eod_checkins | 5+5tx (5 in Promise.all on one pg client => serial) | tasks: SELECT * with NO WHERE and NO LIMIT (entire tasks table); risks open only; snapshots/adoption/eod date >= since | via intelligenceService.load (services/intelligence.ts:11): intelligence.tsx:41 (mount) | WORST payload: full tasks table SELECT * |
| S-060 | fetchLeavesFn | GET /_serverFn/bf8777ef… | services/leaves.functions.ts:13 | Leaves list with joins (optional filters) | R leaves, profiles (x3 join); W (throttled) leaves/notifications/tasks/profiles via promoteDueTentativeLeaves; DDL once/process (ensureLeavesTableAdmin) | 1 SELECT (pool.query, NO RLS, no tx) + at most 1 UPDATE per 60s per process (+ per promoted leave: autoPause SELECT/UPDATE loop, profile SELECT, 2 notification INSERTs) | NO LIMIT; unfiltered call returns ALL leaves; no ownership filter in handler | via leavesService.getLeaves (services/leaves.ts:15): calendar.tsx:140 (mount, unfiltered) + :163 (RT leaves); leaves.tsx:61 (mount, unfiltered); lib/task-form-options.ts:128 (cached 60s, TaskFormDialog.tsx:477 on open); executive.tsx:262 + team-capacity.tsx:310 (filter today/today/__all; useQuery staleTime 30s; RT leaves); MyLeaveReportDialog.tsx:43 (open; userId+year) | DUPLICATE: identical {startDate:today,endDate:today,status:__all} query on executive and team-capacity; identical unfiltered query on calendar, leaves page and task form |
| S-061 | createLeaveFn | POST /_serverFn/b1c6e66b… | services/leaves.functions.ts:88 | Create leave (+notifications, auto-pause tasks) | R user_roles, profiles, holidays; W leaves, notifications, tasks (autoPause) | ~5-12+ (role check, holidays, INSERT, optional autoPause loop SELECT+UPDATE per active task, profile lookups, notification INSERT per recipient in for loop) | n/a | leaves.ts:29 via LeaveDialog.tsx:159 (click) | loop: one INSERT per notification recipient |
| S-062 | updateLeaveStatusFn | POST /_serverFn/f7a8a035… | services/leaves.functions.ts:236 | Approve/reject leave | W leaves, notifications, tasks | 2-4+ (UPDATE, optional autoPause loop, notification INSERT) | n/a | leaves.ts:50 via calendar.tsx:186,196; leaves.tsx:78,91 (click) | - |
| S-063 | updateLeaveDetailsFn | POST /_serverFn/0aceb5e2… | services/leaves.functions.ts:293 | Edit leave | R leaves, user_roles, holidays; W leaves, tasks | 3-6+ (SELECT existing, 1-2 role checks, holidays, UPDATE, optional autoPause) | n/a | leaves.ts:45 via LeaveDialog.tsx:141 (click) | - |
| S-064 | deleteLeaveFn | POST /_serverFn/53947c9e… | services/leaves.functions.ts:428 | Cancel/delete leave | R leaves, user_roles, profiles; W leaves, notifications | 3-5+ (SELECT, DELETE or UPDATE, profile, notification INSERT) | n/a | leaves.ts:54 via calendar.tsx:206; leaves.tsx:105,119 (click) | - |
| S-065 | checkAndNotifyTomorrowLeavesFn | POST /_serverFn/ccbc84f1… | services/leaves.functions.ts:510 | Notify managers of leaves starting tomorrow | R leaves, profiles, user_roles; W notifications | 2 + (managers x leaves) notification INSERTs in nested for loops (leaves.functions.ts:547-557) | NO LIMIT | leavesService.checkTomorrowLeavesNotification (leaves.ts:58): NO caller in src | UNUSED from client; nested-loop INSERTs |
| S-066 | checkUnstartedTasksTodayFn | GET /_serverFn/bac91bec… | services/leaves.functions.ts:576 | 12 PM unstarted-tasks check for current user | R leaves, profiles, tasks | 3 pool.query (no tx): leave check, profile, tasks | WHERE assigned_to=user; no LIMIT | leaves.ts:62 via components/UnstartedTaskLeaveModal.tsx:31 (effect on mount; mounted in routes/_authenticated.tsx:111 => every authenticated page load unless sessionStorage dismissed key set) | Global/shell: fires on every full page load/login (guard only set on dismiss) |
| S-067 | quickMarkLeaveTodayFn | POST /_serverFn/8c13709e… | services/leaves.functions.ts:651 | Quick-mark leave today | R leaves, profiles, user_roles; W leaves, tasks, notifications | ~5-10 (existing check, INSERT, autoPause loop, profile, managers, INSERT per manager) | n/a | leaves.ts:66 via UnstartedTaskLeaveModal.tsx:53 (click) | - |
| S-068 | listNotebookNotesFn | GET /_serverFn/cf7426e6… | services/notebook.functions.ts:64 | List my notes (+first-login seed) | R/W notebook_seeded, notebook_notes (+DDL once/process) | 2-3 + SELECT = up to 3 +5tx (+DDL once) | WHERE user_id; NO LIMIT; includes images jsonb | notebook.ts:11 via components/notebook/notesStore.ts:112 (loadNotes; first useNotes subscriber; DockNotepadBar/DraggableNotepadModal mounted in AppShell.tsx:786-790; QuickNotesWidget.tsx:62) | Global/shell: once per session (store status guard) |
| S-069 | upsertNotebookNoteFn | POST /_serverFn/56685b6a… | services/notebook.functions.ts:93 | Save a note | W notebook_notes | 1+5tx | n/a | notebook.ts:15 via notesStore.ts:44 (debounced per note), :96 (Promise.all over imported legacy notes) | one call per debounced edit; bulk legacy import fan-out |
| S-070 | deleteNotebookNoteFn | POST /_serverFn/2e02f95c… | services/notebook.functions.ts:129 | Delete a note | W notebook_notes | 1+5tx | n/a | notesStore.ts:158 (click) | - |
| S-071 | clearNotebookNotesFn | POST /_serverFn/9a1692d1… | services/notebook.functions.ts:143 | Delete all my notes | W notebook_notes | 1+5tx | n/a | notesStore.ts:171 (click) | - |
| S-072 | getNotifPrefsFn | GET /_serverFn/3c133977… | services/notif-prefs.functions.ts:56 | Notification prefs of a user | R notification_prefs (+DDL ALTER once/process) | 1+5tx (+1 fallback query on error) | 1 row | via notifPrefsService.get (services/notif-prefs.ts:17): EodReminder.tsx:19 (mount, my-day.tsx:726), settings.email-operations.tsx:86 (mount), settings.notifications.tsx:36 (mount) | Duplicate fetch in EodReminder on every My Day mount (no cache) |
| S-073 | saveNotifPrefsFn | POST /_serverFn/117bac29… | services/notif-prefs.functions.ts:103 | Upsert notification prefs | W notification_prefs | 1-2+5tx | n/a | notif-prefs.ts:22 via settings.email-operations.tsx:148, settings.notifications.tsx:83 (click) | - |
| S-074 | dispatchEodTestEmailFn | POST /_serverFn/3627de47… | services/notif-prefs.functions.ts:196 | Send test EOD email (all users' tasks) | R profiles, tasks (supabaseAdmin, service role); sends email | 2 PostgREST (parallel) + SMTP | profiles active: NO LIMIT; tasks: NO LIMIT and NO filter (whole tasks table) | settings.email-operations.tsx:435, settings.notifications.tsx:391 (click) | Full-table task read for a test email |
| S-075 | dispatchMemberEodTestEmailFn | POST /_serverFn/2d116325… | services/notif-prefs.functions.ts:328 | Send member test EOD email | R profiles, tasks (service role); sends email | 2-3 PostgREST + SMTP | tasks of one user (filter at :375): Not measured | settings.email-operations.tsx:408 (click) | - |
| S-076 | dispatchMorningNudgeTestEmailFn | POST /_serverFn/5b35a04e… | services/notif-prefs.functions.ts:399 | Send morning nudge test email | R profiles, tasks (service role); sends email | 2 PostgREST + SMTP | Not measured | settings.email-operations.tsx:381 (click) | - |
| S-077 | markNotificationReadFn | POST /_serverFn/n/a (generated /_serverFn/<sha256>, not in dist build) | services/notifications.functions.ts:26 | Mark one notification read (+socket announce) | W notifications | 1+5tx + in-process Socket.IO emit | WHERE id,user_id,read_at IS NULL | hooks/use-notifications.tsx:417 (click/open notification; NotificationsProvider in routes/_authenticated.tsx:108) | per click |
| S-078 | markAllNotificationsReadFn | POST /_serverFn/n/a (generated /_serverFn/<sha256>, not in dist build) | services/notifications.functions.ts:43 | Mark all notifications read in window | W notifications | 1+5tx + Socket.IO emit | created_at >= window start | hooks/use-notifications.tsx:431 (click) | - |
| S-079 | fetchActiveNudges | GET /_serverFn/n/a (generated /_serverFn/<sha256>, not in dist build) | services/nudges.functions.ts:7 | Active nudges for user | R nudges | 1+5tx (selectAsUser) | LIMIT 20 | nudgesService.listActive (nudges.ts:6): only components/NudgeCenter.tsx:18, which is never mounted | UNUSED (component not rendered anywhere) |
| S-080 | markNudgeRead | POST /_serverFn/n/a (generated /_serverFn/<sha256>, not in dist build) | services/nudges.functions.ts:26 | Mark nudge read | W nudges | 1+5tx | n/a | NudgeCenter.tsx:37 (never mounted) | UNUSED (component not rendered) |
| S-081 | dismissNudge | POST /_serverFn/n/a (generated /_serverFn/<sha256>, not in dist build) | services/nudges.functions.ts:39 | Dismiss nudge | W nudges | 1+5tx | n/a | NudgeCenter.tsx:32 (never mounted) | UNUSED (component not rendered) |
| S-082 | getOnboardingFn | GET /_serverFn/58f6af22… | services/onboarding.functions.ts:8 | Onboarding state | R tenant_onboarding | 1+5tx | id=1 | onboarding.ts:26 via routes/_authenticated/onboarding.tsx:41 (mount), :56 (after each step) | - |
| S-083 | setOnboardingStepFn | POST /_serverFn/e1832ca6… | services/onboarding.functions.ts:21 | Update onboarding step | W tenant_onboarding | 1+5tx | n/a | onboarding.ts:42 via onboarding.tsx:55 (click) | followed by getOnboardingFn + listWorkItemTypesFn refetch (onboarding.tsx:56-58) |
| S-084 | resetOnboardingFn | POST /_serverFn/f83c0305… | services/onboarding.functions.ts:61 | Reset onboarding | W tenant_onboarding | 1+5tx | n/a | onboarding.ts:53: no caller found in routes/components | UNUSED from client (service method has no caller) |
| S-085 | getWorkSettingsFn | GET /_serverFn/318ad7c7… | services/operations.functions.ts:8 | Work settings singleton | R work_settings | 1+5tx (+1 fallback on error) | id=1 | via workSettingsService.get (operations.ts:21): command.tsx:43 (inside load(), runs on mount AND on every tasks realtime event: useRealtimeTasks(load) command.tsx:52), settings.operations.tsx:152 (mount), settings.email-operations.tsx:86 (mount) | HIGH-TRAFFIC/DUPLICATE: command.tsx:42-43 re-fetches rarely-changing settings + all open risks on each tasks event |
| S-086 | updateWorkSettingsFn | POST /_serverFn/9f164f36… | services/operations.functions.ts:37 | Update work settings | W work_settings | 1+5tx | n/a | operations.ts:27 via settings.operations.tsx:284, settings.email-operations.tsx:140 (click) | - |
| S-087 | getStreakForUserFn | GET /_serverFn/bad00f9b… | services/operations.functions.ts:65 | Streak of a user | R user_streaks | 1+5tx | 1 row | streaksService.forUser: components/StreakChip.tsx:12, component never mounted | UNUSED (component not rendered) |
| S-088 | listAllStreaksFn | GET /_serverFn/2e5f7a16… | services/operations.functions.ts:82 | All streaks | R user_streaks | 1+5tx | NO LIMIT, NO WHERE | streaksService.all (operations.ts:36): NO caller in src | UNUSED from client |
| S-089 | listTeamsFn | GET /_serverFn/f8e8ee88… | services/operations.functions.ts:99 | List teams | R teams | 1+5tx | NO LIMIT | operations.ts:42 via settings.operations.tsx:152 (mount/load) | - |
| S-090 | createTeamFn | POST /_serverFn/f05e2f6f… | services/operations.functions.ts:112 | Create team | W teams | 1+5tx | n/a | settings.operations.tsx:483 (click) | - |
| S-091 | deleteTeamFn | POST /_serverFn/f482aecd… | services/operations.functions.ts:130 | Delete team | W teams | 1+5tx | n/a | settings.operations.tsx:303 (click) | - |
| S-092 | listProjectsFn | GET /_serverFn/b66108cd… | services/operations.functions.ts:146 | List projects | R projects | 1+5tx | NO LIMIT | operations.ts:54 via settings.operations.tsx:152 (mount/load) | Other pages read projects via PostgREST (not this fn) |
| S-093 | createProjectFn | POST /_serverFn/d3d9ea7d… | services/operations.functions.ts:159 | Create project | W projects | 1+5tx | n/a | settings.operations.tsx:505 (click) | - |
| S-094 | updateProjectFn | POST /_serverFn/1f49dddf… | services/operations.functions.ts:177 | Update project | W projects | 1+5tx | n/a | projectsService.update (operations.ts:60): NO caller | UNUSED from client |
| S-095 | deleteProjectFn | POST /_serverFn/67262989… | services/operations.functions.ts:195 | Delete project | W projects | 1+5tx | n/a | settings.operations.tsx:321 (click) | - |
| S-096 | listHolidaysFn | GET /_serverFn/b04a9e67… | services/operations.functions.ts:209 | List holiday calendar | R holiday_calendar | 1+5tx | NO LIMIT | via holidaysService.list (operations.ts:69): HolidayBanner.tsx:85 (every AppShell mount), calendar.tsx:141 (mount), LeaveDialog.tsx:82 (open), settings.operations.tsx:152, lib/task-form-options.ts:125 (cached 5 min; TaskFormDialog.tsx:434 open) | DUPLICATE: same unfiltered list fetched by shell, calendar, leave dialog, task form, settings |
| S-097 | addHolidayFn | POST /_serverFn/287a9b92… | services/operations.functions.ts:223 | Add holiday | W holiday_calendar | 1+5tx | n/a | settings.operations.tsx:376,386,544 (click; loop on bulk import at :376) | loop on import |
| S-098 | removeHolidayFn | POST /_serverFn/35f67cca… | services/operations.functions.ts:240 | Remove holiday | W holiday_calendar | 1+5tx | n/a | settings.operations.tsx:438 (click) | - |
| S-099 | listOrgRolesFn | GET /_serverFn/0a46197d… | services/org-roles.functions.ts:21 | List org roles | R org_roles | 1+5tx | no LIMIT | orgRolesService.list (org-roles.ts:20): configure/RoleSelect.tsx:16 (mount per RoleSelect instance), RolesPanel.tsx:30 (mount) | Duplicate per RoleSelect instance (no cache) |
| S-100 | createOrgRoleFn | POST /_serverFn/ce5ee06d… | services/org-roles.functions.ts:38 | Create org role | W org_roles | 1+5tx | n/a | RolesPanel.tsx:140 (click) | - |
| S-101 | updateOrgRoleFn | POST /_serverFn/70ad054f… | services/org-roles.functions.ts:64 | Update org role | R/W org_roles | 1-2+5tx | n/a | RolesPanel.tsx:39,138 (click) | - |
| S-102 | listOrgRoleHierarchyFn | GET /_serverFn/8f5886df… | services/org-roles.functions.ts:105 | Role hierarchy edges | R org_role_hierarchy | 1+5tx | NO LIMIT | RolesPanel.tsx:31 (mount) | - |
| S-103 | setOrgRoleParentFn | POST /_serverFn/56eb19c8… | services/org-roles.functions.ts:117 | Set parent role | W org_role_hierarchy | 1-3+5tx (DELETE + optional INSERT) | n/a | RolesPanel.tsx:44 (click) | - |
| S-104 | listOrgRoleMembersFn | GET /_serverFn/26eeefab… | services/org-roles.functions.ts:144 | Members of a role | R user_org_roles | 1+5tx | WHERE role_id; no LIMIT | RolesPanel.tsx:171 (click) | - |
| S-105 | assignOrgRoleFn | POST /_serverFn/a4239d44… | services/org-roles.functions.ts:160 | Assign role to user | W user_org_roles | 1+5tx | n/a | RolesPanel.tsx:184 (click) | - |
| S-106 | unassignOrgRoleFn | POST /_serverFn/1f8ce554… | services/org-roles.functions.ts:179 | Unassign role | W user_org_roles | 1+5tx | n/a | RolesPanel.tsx:188 (click) | - |
| S-107 | myOrgRoleKeysFn | GET /_serverFn/f50ae14e… | services/org-roles.functions.ts:197 | Caller's org role keys | R user_org_roles, org_roles | 1+5tx | WHERE user_id | orgRolesService.myRoleKeys (org-roles.ts:63): NO caller | UNUSED from client |
| S-108 | fetchOpenSuggestions | GET /_serverFn/1cb54b36… | services/planning-suggestions.functions.ts:7 | Open planning suggestions | R planning_suggestions | 1+5tx (selectAsUser) | WHERE status=open; NO LIMIT | planning-suggestions.ts:14 via components/SuggestionsPanel.tsx:28 (mount; RT: planning_suggestions events SuggestionsPanel.tsx:30-32); panel rendered in command.tsx:199 and planning-suggestions.tsx:32 | RT-driven; panel returns null for non-managers AFTER fetching (SuggestionsPanel.tsx:38 vs effect at :28-36) |
| S-109 | resolveSuggestion | POST /_serverFn/23350cb9… | services/planning-suggestions.functions.ts:22 | Accept/dismiss suggestion | W planning_suggestions | 1+5tx | n/a | planning-suggestions.ts:20 via SuggestionsPanel.tsx:71,81 (click) | - |
| S-110 | fetchTomorrowRisks | GET /_serverFn/a6ebe164… | services/predictions.functions.ts:6 | Predicted risks tomorrow via DB function predict_tomorrow_risks() | R (inside function) tasks etc - Not measured | 1+5tx (selectAsUser) | function-side: Not measured | predictions.ts:6 via components/TomorrowRiskPanel.tsx:18 (mount; command.tsx:198, planning-suggestions.tsx:33) | - |
| S-111 | listRelationsFn | GET /_serverFn/n/a (generated /_serverFn/<sha256>, not in dist build) | services/relations.functions.ts:32 | Relations of a work item | R work_item_relations | 1+5tx | WHERE from OR to | relationsService.listForItem (relations.ts:13): NO caller (RelationsPanel component does not exist) | UNUSED from client |
| S-112 | linkRelationFn | POST /_serverFn/n/a (generated /_serverFn/<sha256>, not in dist build) | services/relations.functions.ts:52 | Link work items | W work_item_relations | 1+5tx | n/a | relations.ts:21: NO caller | UNUSED from client |
| S-113 | unlinkRelationFn | POST /_serverFn/n/a (generated /_serverFn/<sha256>, not in dist build) | services/relations.functions.ts:78 | Unlink work items | W work_item_relations | 1+5tx | n/a | relations.ts:25: NO caller | UNUSED from client |
| S-114 | submitForReviewFn | POST /_serverFn/81eb5299… | services/reviews.functions.ts:45 | Submit task for review via submit_task_for_review() | W task_reviews, tasks (inside function) - Not measured | 1+5tx | n/a | reviews.ts:46 via ReviewSubmitDialog.tsx:121 (click) | - |
| S-115 | logReviewHoursFn | POST /_serverFn/460c1842… | services/reviews.functions.ts:69 | Log review hours via log_review_hours() | W (inside function) - Not measured | 1+5tx | n/a | reviews.ts:53 via ReviewSubmitDialog.tsx:118 (click) | - |
| S-116 | decideReviewFn | POST /_serverFn/742ebf43… | services/reviews.functions.ts:93 | Approve / request changes via decide_task_review() | W task_review_decisions, task_reviews, tasks (inside function) - Not measured | 1+5tx | n/a | reviews.ts:62,71 via ReviewDecisionDialog.tsx:76,83 (click) | - |
| S-117 | listTaskReviewsFn | POST /_serverFn/8578ab37… | services/reviews.functions.ts:127 | Review cycles of a task with decisions | R task_reviews, task_review_decisions, task_reviewers, tasks | 1+5tx (correlated json_agg sub-selects) | WHERE task_id; no LIMIT | reviews.ts:87 via components/review/ReviewInfo.tsx:114 (effect on taskId/refreshKey; mounted in TaskDetailModal.tsx and reviews.tsx), hooks/use-review-decisions.ts:24 (useQuery key [REVIEW_DECISIONS_KEY,taskId,review_submitted_at], enabled when status='In Review', staleTime 10s) | DUPLICATE: ReviewInfo.tsx:114 and use-review-decisions.ts:24 issue the same listForTask(taskId) per card (per In Review task shown) |
| S-118 | listReviewQueueFn | POST /_serverFn/2d731d15… | services/reviews.functions.ts:149 | Review queue (mine/all) | R tasks, task_reviews, task_review_decisions, pending_review_assignments; is_manager_or_admin() | 2+5tx (permission check for scope=all + queue SELECT) | WHERE status='In Review'; NO LIMIT | reviews.ts:91 via routes/_authenticated/reviews.tsx:37 (mount/scope change, inside load()); RT: reviews.tsx:61 useRealtimeTasks(load, all tasks) and :57 useReviewDecisionsRealtime(load) | HIGH-TRAFFIC: reloaded on EVERY org-wide tasks event and every review-decision event while page open |
| S-119 | listTaskReviewersFn | POST /_serverFn/b2339f8c… | services/reviews.functions.ts:195 | Reviewers of a task | R task_reviewers | 1+5tx | WHERE task_id | reviews.ts:78 via TaskFormDialog.tsx:185 (form open, edit mode) | - |
| S-120 | setTaskReviewersFn | POST /_serverFn/c86b7393… | services/reviews.functions.ts:212 | Set reviewers via set_task_reviewers() | W task_reviewers (inside function) | 1+5tx | n/a | reviewsService.setReviewers (reviews.ts:83): NO caller in src (reviewers are applied inside createTaskFn/updateTaskFn) | UNUSED from client |
| S-121 | listOpenRisksFn | GET /_serverFn/9191eb08… | services/risks.functions.ts:13 | All open risk events | R risk_events | 1+5tx | WHERE resolved_at IS NULL; NO LIMIT | risks.ts:26 via command.tsx:42 (inside load(): mount + every tasks RT event) and :58 (RT risk_events) and :108 (after detect) | HIGH-TRAFFIC: invoked per tasks event and per risk_events event on /command |
| S-122 | resolveRiskFn | POST /_serverFn/5fdfafb6… | services/risks.functions.ts:29 | Resolve risk | W risk_events | 1+5tx | n/a | risks.ts:29 via command.tsx:99 (click) | - |
| S-123 | listMyEodTasksFn | POST /_serverFn/2f7bc395… | services/task-eod.functions.ts:46 | Today's EOD task rows for me | R tasks, task_eod_submissions | 1+5tx | WHERE assigned_to=me AND date logic; no LIMIT | task-eod.ts:16 via eod-tasks.tsx:64 (mount/reload after each submit), components/review/ReviewSubmitDialog.tsx:73 (dialog open, assignee) | Duplicate with ReviewSubmitDialog (re-reads the full EOD list to find 1 task) |
| S-124 | upsertTaskEodFn | POST /_serverFn/3b7e872f… | services/task-eod.functions.ts:96 | Submit task EOD (+bank timer, update tasks) | W task_eod_submissions, tasks, task_worklogs; push | 6-10+5tx (upsert, SUM, status, UPDATE actual_hours, FOR UPDATE, bankTimer, UPDATE tasks) | n/a | task-eod.ts:24 via eod-tasks.tsx:124, CompleteTaskEodDialog.tsx:124, TaskCard.tsx:276, TaskQuickActionModal.tsx:113 (click) | - |
| S-125 | listEodForDateFn | GET /_serverFn/d5788ffc… | services/task-eod.functions.ts:219 | Manager view of task EOD submissions of a date | R task_eod_submissions, tasks, profiles | 1+5tx | WHERE submission_date; no LIMIT | task-eod.ts:29 via components/TaskEodReviewCard.tsx:23 (mount; dashboard.tsx:109, + after acknowledge) | - |
| S-126 | acknowledgeEodFn | POST /_serverFn/e5aa954f… | services/task-eod.functions.ts:244 | Acknowledge an EOD submission | W task_eod_submissions | 1+5tx | n/a | task-eod.ts:32 via TaskEodReviewCard.tsx:39 (click) | - |
| S-127 | fetchTaskNameHintsFn | GET /_serverFn/n/a (generated /_serverFn/<sha256>, not in dist build) | services/task-form-hints.functions.ts:31 | Last project/client per assignee + distinct pairs | R tasks | 2+5tx (2 CTE queries in Promise.all on one pg client => serial; each scans recent window) | LIMIT 1000 rows (TASK_HINT_ROWS; zod max 5000) | lib/task-form-options.ts:90 (cached 5 min TTL; TaskFormDialog.tsx:394,439 on dialog open; falls back to PostgREST tasks read on error) | per dialog open if cache expired |
| S-128 | createTaskFn | POST /_serverFn/879196c2… | services/tasks.functions.ts:54 | Create task (+reviewers, pause other timers, notify assignee) | W tasks, notifications, task_reviewers; R/W tasks (pause others), task_history/worklogs | 1 INSERT + optional pauseOtherRunningTimers (1 SELECT + per other running task: UPDATE + worklog + SAVEPOINTs) + optional applyReviewers (2) + notification (SAVEPOINT x2 + INSERT) +5tx = ~2-12; DB triggers add more (not measured) | n/a | tasks.ts:89: TaskFormDialog.tsx:794 (Promise.all over grid rows), :847 (Promise.all over selected assignees), :863, :893 (click save); tasks.tsx:565 (bulk duplicate, Promise.all per task); CSVImportDialog.tsx:673 (Promise.all per CSV row); InteractiveFigmaDemoModal.tsx:120 | FAN-OUT: one HTTP call + tx per row in bulk create/import/duplicate |
| S-129 | updateTaskFn | POST /_serverFn/475ddaf9… | services/tasks.functions.ts:140 | Update task (timer banking, reassign, reviewers, notifications) | R/W tasks; W task_worklogs, notifications, task_reviewers; triggers write task_history | ~3-12+5tx (SELECT FOR UPDATE, bankTimer 3-6, pauseOtherRunningTimers 1+, UPDATE (+fallback UPDATE), reassign_task, applyReviewers 1-2, notification INSERT) + after-commit pushTaskProgress (FCM) | n/a | tasks.ts:116 via many: TaskCard.tsx:1140 etc, TaskDetailModal.tsx:251,266,286, TaskQuickActionModal.tsx:149, TaskFormDialog.tsx:749,758, tasks.tsx:527,547 (Promise.all per selected task), CSVImportDialog.tsx:666, plus pause/resume/switch/transfer/setPriority wrappers (tasks.ts:201-277) | FAN-OUT in bulk reassign/project change (tasks.tsx:524-549); switchActiveTask = 2 sequential updateTaskFn |
| S-130 | notifyTaskBlockedFn | POST /_serverFn/b62abd1c… | services/tasks.functions.ts:307 | Notify on blocked via notify_task_blocked() | W notifications (inside function) | 1+5tx | n/a | tasks.ts:191 (after updateTaskFn when status Blocked) | 2nd round trip after updateTaskFn |
| S-131 | insertAssignmentNotificationFn | POST /_serverFn/7ef4d50d… | services/tasks.functions.ts:319 | Insert assignment notification | R tasks, profiles; W notifications | 3+5tx | n/a | imported at services/tasks.ts:20, never invoked | UNUSED from client (notification now inserted inside createTaskFn/updateTaskFn) |
| S-132 | addTaskCommentHistoryFn | POST /_serverFn/52a42617… | services/tasks.functions.ts:356 | Add comment line to task_history | W task_history | 1+5tx | n/a | tasksService.addComment (tasks.ts:282): NO caller in src (tests only) | UNUSED from client |
| S-133 | deleteTaskFn | POST /_serverFn/a5f8301b… | services/tasks.functions.ts:374 | Delete task | W tasks | 1+5tx | n/a | tasks.ts:288 via TaskCard.tsx:490 (click), tasks.tsx:495 (Promise.all per selected id) | FAN-OUT: one call per selected id in bulk delete |
| S-134 | listTemplatesFn | GET /_serverFn/e0a23e43… | services/templates.functions.ts:6 | Industry templates | R industry_templates | 1+5tx | NO LIMIT | templates.ts:31 via TemplatesPanel.tsx:23 (mount), onboarding.tsx:42 (mount) | - |
| S-135 | listTemplateComponentsFn | GET /_serverFn/e1206586… | services/templates.functions.ts:22 | Components of a template | R template_components | 1+5tx | WHERE template_id | templates.ts:35 via TemplatesPanel.tsx:27 (loop: one call per template after list: N+1), TemplatePreviewDrawer.tsx:39 (open) | N+1: TemplatesPanel.tsx:25-28 calls once per template |
| S-136 | installTemplateFn | POST /_serverFn/28a1b310… | services/templates.functions.ts:42 | Install template via install_template() | W many config tables (inside function) - Not measured | 1+5tx | n/a | templates.ts:41 via TemplatesPanel.tsx:38, onboarding.tsx:126 (click) | - |
| S-137 | listWorkItemTypesFn | GET /_serverFn/5c17056c… | services/work-item-types.functions.ts:24 | Work item types | R work_item_types | 1+5tx | NO LIMIT | work-item-types.ts:21: lib/task-form-options.ts:122 (cached 5 min, TaskFormDialog.tsx:433 open), TaskHistorySheet.tsx:97 (sheet open, no cache), RuleEditorDrawer.tsx:73, RulesPanel.tsx:41, configure/{Approvals,Fields,Statuses,Workflow}Panel (mount), TypesPanel.tsx:25, onboarding.tsx:43,58 | DUPLICATE: same list fetched by ~10 components; uncached outside task form |
| S-138 | createWorkItemTypeFn | POST /_serverFn/8532de8f… | services/work-item-types.functions.ts:41 | Create type | W work_item_types | 1+5tx | n/a | TypesPanel.tsx:127, configure.new.tsx:143 (click) | - |
| S-139 | updateWorkItemTypeFn | POST /_serverFn/a4dcb4fb… | services/work-item-types.functions.ts:66 | Update type | R/W work_item_types | 1-2+5tx | n/a | TypesPanel.tsx:126, onboarding.tsx:154 (click) | - |
| S-140 | setWorkItemTypeActiveFn | POST /_serverFn/486e5fcb… | services/work-item-types.functions.ts:102 | Toggle type active | W work_item_types | 1+5tx | n/a | TypesPanel.tsx:47 (click) | - |
| S-141 | listStatusesFn | GET /_serverFn/95732cc1… | services/workflow.functions.ts:10 | Statuses of a type | R work_item_statuses | 1+5tx | WHERE type_id | workflow.ts:33: StatusesPanel.tsx:39, WorkflowPanel.tsx:38, TypePreviewSheet.tsx:47, TypesPanel.tsx:31 (N+1: per type in loop) | N+1 in TypesPanel.tsx:25-33 (statuses + transitions per type) |
| S-142 | listTransitionsFn | GET /_serverFn/25fe0c58… | services/workflow.functions.ts:28 | Transitions of a type | R work_item_transitions | 1+5tx | WHERE type_id | workflow.ts:37: WorkflowPanel.tsx:39, TypePreviewSheet.tsx:48, TypesPanel.tsx:32 (per type) | N+1 in TypesPanel |
| S-143 | upsertWorkloadSnapshotsFn | POST /_serverFn/9a0f2a7b… | services/workload.functions.ts:20 | Upsert daily workload snapshots | W daily_workload_snapshot | rows.length + 5tx (sequential INSERT..ON CONFLICT per row in for loop, workload.functions.ts:25) | rows from client (one per user) | workload.ts:58 via eod.tsx:264 (click), heatmap.tsx:61 (click) | LOOP: one statement per row |

Commented-out (not counted): S-C01 `last7DaysWorkloadFn` GET, src/services/workload.functions.ts:57 (also commented in src/services/workload.ts:5,62; heatmap.tsx:33 references `workloadService.last7Days()` which no longer exists).

### 1A. Full serverFn ids (from dist manifest dist/server/assets/server-CdoVjvEL.js)

| ID | Function | Endpoint |
|---|---|---|
| S-001 | getDownloadUrlFn | /_serverFn/354edeedc9c93081c0ed733c3bccd3770910de60630c931a89cdf63a4990ef9e |
| S-002 | deleteObjectsFn | /_serverFn/8d6182553fdc29dbaed90309590893b3a9565169b9b88a2658e44cec2e66a883 |
| S-003 | deleteUser | /_serverFn/c5ad5da54aa792fde0a2922779ecceab12ed14a012d7103d4444eb182c943a80 |
| S-004 | updateUserAdminSettings | /_serverFn/a25c819fc83101914787e52fdefa94e3bc164ae065c7790d08960828cbc36718 |
| S-005 | getExecSummary | /_serverFn/5ea2b6bbd29ad7d17ece247ed07ce9f271228e4b4bc5b306284826e939b4183f |
| S-006 | getExecScope | /_serverFn/dfd023c86521dfd85f966e2eb6d055cbae46595af9d9c648964987bac12af4cf |
| S-007 | getForecast | /_serverFn/0e7b51226ff5c038fe2e0becf0118de119b83a22d499d85e55c08bbbe1f61635 |
| S-008 | getManagerCommand | /_serverFn/7ddf4cd3579c3cb2c20ba49f95c5632be45c3941a144adfedde2117682ff2281 |
| S-009 | getMyDay | /_serverFn/2e23b26502f55cca0656ca70cb86c047de752ad562eab8a89db82aa06feda37c |
| S-010 | seedQaAccounts | generated /_serverFn/<sha256 hash> (function absent from the stale dist build) |
| S-011 | fetchAdoptionLast14 | /_serverFn/cbd088c09d89a987a8c0ef7bb0338297ebf827f49d728ff06ce9a7fae64c13ab |
| S-012 | fetchActiveAnnouncements | /_serverFn/06191a7c1b9bd1619ba198ebaf85263fb7f2ca1eee6724f4738cf1e23f2caa3f |
| S-013 | fetchAllAnnouncements | /_serverFn/895f75c6f81df86a5a41e6dc22c76fceadf5895c1cbc6637418570607aad5a58 |
| S-014 | createAnnouncement | /_serverFn/1c6d53efcc3850855af820f3955a0506c20c336c11d325ac9e9d081f4b4459bc |
| S-015 | deleteAnnouncement | /_serverFn/6b15bd452181ad10a46d2b3b2620c7935d52d5c6be839b1577402b58900947bd |
| S-016 | listChainsForTypeFn | /_serverFn/5e0e1a8ad322d9ca6f702e98052334280d1b35947bf1ee1453add8d96df26132 |
| S-017 | listApprovalStepsFn | /_serverFn/77d42dffd41aa1ba9bea8e4eeed7fbf9dbf7b1ee4d45ca17027ec7c4a0a90490 |
| S-018 | startApprovalRequestFn | /_serverFn/41d93477eb2a4a5112bdf3fabd11523271ab51bedeaf63ee23d10635036051d4 |
| S-019 | decideApprovalFn | /_serverFn/3bba3335a134e9ed247b6791df7ef684b05a3b40dc27c288ec8aa2fb87b1b595 |
| S-020 | listApprovalsForWorkItemFn | /_serverFn/f6417eb2eba9366e9775d0144dbfa354027c802663d649d2d2d44ff4fb01982c |
| S-021 | listAttachmentsFn | /_serverFn/dbc8f3d511e30f1b72aaf295f557690df90c25a2f93b92335431ce7a56a554c3 |
| S-022 | insertAttachmentMetaFn | /_serverFn/095b86ae0d8880a49d0c3ca482a7c331979a702d74e6289b2679ce06df1294b5 |
| S-023 | deleteAttachmentMetaFn | /_serverFn/70b8ea99787fdfafce2c084ce2240d9e35e09c89d175b8546a1f3cd93e977c60 |
| S-024 | listAutomationRulesFn | /_serverFn/ddfb7eef07679c60d5d49c6189105277d119a0d86602772ac0f3f10e37bbe7d3 |
| S-025 | getAutomationRuleFn | /_serverFn/1e0bd55784c409b40fdcd3899b90029e4f24eae25e709e06eb6ff4b2833a29b9 |
| S-026 | createAutomationRuleFn | /_serverFn/f99ba2b5b861c09721628f29c5c1edc27b57d71d3f540e32f828ac1a154e1ebb |
| S-027 | updateAutomationRuleFn | /_serverFn/96a91249a5967f045ec2a07a7476cc399ad6928c949991d9cdb94429f3aa46de |
| S-028 | deleteAutomationRuleFn | /_serverFn/10b87f48d539374eb89604e7f2204523e7fc8baf05ae888353f8af5fa665fa20 |
| S-029 | listAutomationRunsFn | /_serverFn/c8bf908a7158160c1c918b485952261129ff00c8ba21224f0b0022a9896c864e |
| S-030 | replayAutomationRunFn | /_serverFn/c009f8c76147575e4626371eee24c793185e79bf536a1588f6eff6f14857c113 |
| S-031 | automationHealthFn | /_serverFn/260eed3ed1c1965f85b8857381b9258299a6b4338eec74b5be16ba0cf836e81c |
| S-032 | carryTaskForwardFn | /_serverFn/8818b17b503d2fd1587fe974de80d66b85413e28bf0623a4b3640a0aca62981f |
| S-033 | carryForwardWithTimerFn | /_serverFn/8fc8146afd71024fbb23a606b3dae4fa176e2bf32d0d8bbebbc22af8dcbca4e6 |
| S-034 | listOverdueForUserFn | /_serverFn/654c17ae47bda882a056ed12a0526e17c175823f4286c6920823b6fb007e7f51 |
| S-035 | listCarryEventsForTaskFn | /_serverFn/fab75e535ecef1541c8da29db87c93d319c209eb757422fcc9d7ac51d30831cf |
| S-036 | listCommentsFn | /_serverFn/df7b1cbf0e97000da17fe0cf01d8e083e30aed340f3ad7b1419842b17f826301 |
| S-037 | listMentionableUsersFn | /_serverFn/fa0d7f1e572f6c84a62b974a17067bb87f76c5dca4abb3c3a21cb3b7c312bcd0 |
| S-038 | addCommentFn | /_serverFn/82ab8a28615ca88b830b8428f536a23e81c9a621b77b262173391d6820b20949 |
| S-039 | editCommentFn | /_serverFn/149593aea1a082f28c77e8b9d6a8d7c89c4992b5786f6790df49c7ca25ac0dee |
| S-040 | removeCommentFn | /_serverFn/b9faa03dfe088abc3ec2200c6dcf50c99fd53446be9e85c3befd9c5a46bced4c |
| S-041 | fetchCurrentConfigFn | /_serverFn/7c5970b9ea79204c1d6f76446b190b3f4421d607daf84b6f8ac989b063928c99 |
| S-042 | importConfigFn | /_serverFn/afbcac491b6b217afed5aa4df13f90d83c6a6fd7ffccc4e73a42f673fe2188d1 |
| S-043 | listConfigSnapshotsFn | /_serverFn/c1b0e090e688229976e2cfcb0e9c0edb0c3082e3f283a99d71760db61ad72a9b |
| S-044 | snapshotConfigFn | /_serverFn/5428a74bb3848eec992e1fd0e2ee5e998544f188cf02b70207917cd7b51575f7 |
| S-045 | restoreConfigFn | /_serverFn/827aa6cd7e97e29d0613f63b3b530e04559ad92e045df8f8ee1e23c335b179c4 |
| S-046 | deleteConfigSnapshotFn | /_serverFn/5f83fd36bd71da313b7526a0af5e534b767c05164c0842d51ba83817596de8ac |
| S-047 | submitDemoFeedback | /_serverFn/d97634f29a6ab609b1abbd80215ce8d53892e69c6f8c30b294f2fba49cfb0c69 |
| S-048 | fetchDemoFeedbackStats | /_serverFn/47e1065e29059847260e478bc21b7a6dcf838154299d5e749bf46ee09867ef08 |
| S-049 | clearAllDemoFeedback | /_serverFn/31b6796dc6779a0c215f8e09335cacf1d4acbbece81b0763214dcc4a74a8f377 |
| S-050 | registerDeviceTokenFn | /_serverFn/5c340be7b37985925a67897ce9b7b9c0dfa7984334fe5b9ac3392743bef9d568 |
| S-051 | unregisterDeviceTokenFn | /_serverFn/b75dc29b65329ffe5df351483ff51f65f6c2bf94008a6d304be82116753cf2e9 |
| S-052 | listFieldDefsFn | /_serverFn/8711faabd1000145babbb14028846a036b9c6451c6b00cf232318a175d90b8ff |
| S-053 | getEodTodayFn | /_serverFn/9d9defbd66461fc99403c7b572ac20ebd3bc574198eb383f98f351ff82f88186 |
| S-054 | upsertEodFn | /_serverFn/9d414ae9355d4034c9c9f681bf7dbbe1ad9ecf337a84e667f862c56813b7d6aa |
| S-055 | listEodForDateFn | /_serverFn/35355345c8f86d6fe8d8f0af0cfd27364d80f5e9aa7321a82804ebab31942e5f |
| S-056 | buildExportRowsFn | /_serverFn/cf0b3b8c913dcd20060c236e55e0ac0d3352ea15d08c30c77452e9bea60cd708 |
| S-057 | recordExportFn | /_serverFn/5c43050f5afd645eb3c35ea19b0ac39686710fa52ecfe735331140b800cb07c3 |
| S-058 | getMonthlyCapacityReportFn | /_serverFn/47a92403ab5236765ffd326bcf3494cf1383c53c8ee54693706e803ad4d820f8 |
| S-059 | fetchIntelligenceBundle | /_serverFn/9ece234f64feb0c33e88c478a8f03a20492164d9d465b5d8af6e592fc8bc6a96 |
| S-060 | fetchLeavesFn | /_serverFn/bf8777ef1a4c7b610346310964c523923149ef97594424e9e93b850fba2f185b |
| S-061 | createLeaveFn | /_serverFn/b1c6e66bd34444cfeca5c982b7dde7835faa57142863a4867ddccbc61354f78c |
| S-062 | updateLeaveStatusFn | /_serverFn/f7a8a0359082d88730b3260e2b664e03a08b04968900b88bfbda353bf04599a2 |
| S-063 | updateLeaveDetailsFn | /_serverFn/0aceb5e28bbdc233a9c9a8c18dee0ac470a2213fb4d02240c9e7a920ce4b8427 |
| S-064 | deleteLeaveFn | /_serverFn/53947c9e504d31b9b246bd2aaf1be1979722bdcc4943f05b742794fd10764a41 |
| S-065 | checkAndNotifyTomorrowLeavesFn | /_serverFn/ccbc84f1af7abb23b6e927404186e50ae0470cc6a0ad80e665ae7016db2f568e |
| S-066 | checkUnstartedTasksTodayFn | /_serverFn/bac91bec711f6865ee6870ac84c148d0ec6f7744ce43642a9277ecefc6fc04be |
| S-067 | quickMarkLeaveTodayFn | /_serverFn/8c13709e8ec9bc6105381466993a00890a69c032dbc77918449642358eeb5d90 |
| S-068 | listNotebookNotesFn | /_serverFn/cf7426e67067e873a56d0ffdf1dedb123d1b34f1fb98c40afb0c46a5b3dc19cc |
| S-069 | upsertNotebookNoteFn | /_serverFn/56685b6a9931f3c8d79f04a5a59b88582b5e74108cf93e70a21071b420725c51 |
| S-070 | deleteNotebookNoteFn | /_serverFn/2e02f95c9d0ba8a0b8be930d35ecea963dd8d4ce63b348a6310772acfda33569 |
| S-071 | clearNotebookNotesFn | /_serverFn/9a1692d10abb8b1fe6bc781e692ffcaf975d78e9c3807d116d9fe884fc1b9ccd |
| S-072 | getNotifPrefsFn | /_serverFn/3c1339771e1e9bbf9fa292bbf96b1833dbb4b475fafdd7b39aab9d1fcd3de864 |
| S-073 | saveNotifPrefsFn | /_serverFn/117bac29b17c8a2872e979bfbc0d737b9bd81fe460cb3864bb8dde2113e8507f |
| S-074 | dispatchEodTestEmailFn | /_serverFn/3627de47acb79fc402f03d3da353403b8fa9d15fcd7190e80ec90b1f4e32f89f |
| S-075 | dispatchMemberEodTestEmailFn | /_serverFn/2d11632561370ec9010a227489b1e6913baa56483481d1f86a1bb7434f4bb670 |
| S-076 | dispatchMorningNudgeTestEmailFn | /_serverFn/5b35a04e8838fe796f92c3809d102b11b6735f466528ec47387e6c1aedd5eacc |
| S-077 | markNotificationReadFn | generated /_serverFn/<sha256 hash> (function absent from the stale dist build) |
| S-078 | markAllNotificationsReadFn | generated /_serverFn/<sha256 hash> (function absent from the stale dist build) |
| S-079 | fetchActiveNudges | generated /_serverFn/<sha256 hash> (function absent from the stale dist build) |
| S-080 | markNudgeRead | generated /_serverFn/<sha256 hash> (function absent from the stale dist build) |
| S-081 | dismissNudge | generated /_serverFn/<sha256 hash> (function absent from the stale dist build) |
| S-082 | getOnboardingFn | /_serverFn/58f6af22007565d3e7bb57d84e970ed06468742a3846fb69c00edeaf31b46a1b |
| S-083 | setOnboardingStepFn | /_serverFn/e1832ca6127cdd08f75ad7bd7472e92688628233054c88974638e357302ceeb7 |
| S-084 | resetOnboardingFn | /_serverFn/f83c0305b9eae42205e6235b74a7bfa3881f2565f82c9279bd0eda6949f62f69 |
| S-085 | getWorkSettingsFn | /_serverFn/318ad7c7c37b6ec2f4d95cd8b822df12817383332573824fe4228c3680158e8a |
| S-086 | updateWorkSettingsFn | /_serverFn/9f164f360a86be6a4ab556b5a879de3d69af180f4dcf3202100a6d5bb5ca0060 |
| S-087 | getStreakForUserFn | /_serverFn/bad00f9b5598cef72834d194c49621745bb810c21ce36243a4c8a2f7d684d033 |
| S-088 | listAllStreaksFn | /_serverFn/2e5f7a1620fe013fcd7ffd68a2aa91ad714aff17f17bf064710d581a4483fc83 |
| S-089 | listTeamsFn | /_serverFn/f8e8ee88bf300f95d7cbea8824430f058da9fa097d35288284d22863cdf4b06c |
| S-090 | createTeamFn | /_serverFn/f05e2f6f73234096439db1cba46340f5a551a38113bcbed9dbe56c4720cf7a63 |
| S-091 | deleteTeamFn | /_serverFn/f482aecde75a28f5406759830f281dd9dd19fc7b454af134760dbdbe4c201688 |
| S-092 | listProjectsFn | /_serverFn/b66108cd59fc86445a73d3088a62a858e13a2fc00d7d116ca9d014a14984c8f8 |
| S-093 | createProjectFn | /_serverFn/d3d9ea7d7107a2a34b7d59b4aecfdaab5831cc839fed69b9ed1af7e66ac441b5 |
| S-094 | updateProjectFn | /_serverFn/1f49dddf69644455e6feb7a4958c0b067779a55291406f0a388e4e74110c454f |
| S-095 | deleteProjectFn | /_serverFn/67262989df88a41302bfae1a95f19eceafa7ff53963319685e37cde27447195b |
| S-096 | listHolidaysFn | /_serverFn/b04a9e67bff9e7c6711a9a699826bef65f3c7baf1e55058ed973e6c40ff8d5e5 |
| S-097 | addHolidayFn | /_serverFn/287a9b92b4de847d0f7a47ac15e89049f681b86d174b364c190572b90ef10b0b |
| S-098 | removeHolidayFn | /_serverFn/35f67cca52bd8fcfa5fef7582fc5d48f03170a49fef0095fb4bc3c0ec2c83093 |
| S-099 | listOrgRolesFn | /_serverFn/0a46197dd5a42a44e03ea5ba9e13c196d2df05b898f6f1a8fbbff86b1d5649b7 |
| S-100 | createOrgRoleFn | /_serverFn/ce5ee06d5f0c8beba4e862abdfaf5d054294b963b8045e772f821e20e7e2bd5e |
| S-101 | updateOrgRoleFn | /_serverFn/70ad054f42a08306688c4ea3dd2535aaa7f82b6dd63ebfed27c07242f851e65a |
| S-102 | listOrgRoleHierarchyFn | /_serverFn/8f5886df09dff1d1c52121c424643c3679fe08166535496dbd427bca7dbbaa5e |
| S-103 | setOrgRoleParentFn | /_serverFn/56eb19c87587a3e0b7b648da68f2e37cb44bc34b9f9efebf7df27fc5e15b6a41 |
| S-104 | listOrgRoleMembersFn | /_serverFn/26eeefab39444c992cc2a977fb4a924efdb4d2c6f7034ade9895805e38b7ce06 |
| S-105 | assignOrgRoleFn | /_serverFn/a4239d441bb6f009d333246ed80be6c401c8faf206faf22fb249b94dadd709e2 |
| S-106 | unassignOrgRoleFn | /_serverFn/1f8ce554cb4fa10009cc55ebb4d4ba43d5e6f8250a7676890b599b9ed2c247b7 |
| S-107 | myOrgRoleKeysFn | /_serverFn/f50ae14e2fb6af0c2696d09afc723acea75e4bf4fa95d051d7d20d8993c19a28 |
| S-108 | fetchOpenSuggestions | /_serverFn/1cb54b36dc67fc96d1ea0cfa0092b08f9c1f628d85e4f15e62c89716bfdf2958 |
| S-109 | resolveSuggestion | /_serverFn/23350cb922a4f177838acc0a380a3fa409f36867b10f7b9e17b75973ee776cf9 |
| S-110 | fetchTomorrowRisks | /_serverFn/a6ebe164731207d1c6bdc5bcbf444ef7ea589e228051897254cc8f63303e0523 |
| S-111 | listRelationsFn | generated /_serverFn/<sha256 hash> (function absent from the stale dist build) |
| S-112 | linkRelationFn | generated /_serverFn/<sha256 hash> (function absent from the stale dist build) |
| S-113 | unlinkRelationFn | generated /_serverFn/<sha256 hash> (function absent from the stale dist build) |
| S-114 | submitForReviewFn | /_serverFn/81eb52994ce7ce8b3e828398945ed15d590796b54452ddc5cccba61f760edf8b |
| S-115 | logReviewHoursFn | /_serverFn/460c1842360e5addb1a0cc386db6069579be844164e73ac6bded55f83db538d5 |
| S-116 | decideReviewFn | /_serverFn/742ebf43283f8944b1e1458ceed9341e64362db3dd00c924fc716bdf0b8da78d |
| S-117 | listTaskReviewsFn | /_serverFn/8578ab37acaacc8c424dac526e9e6fc006788385782c38a3c7c129934fc49725 |
| S-118 | listReviewQueueFn | /_serverFn/2d731d15d65a3b9a847d285cdc6d76e0b474ade4b2b4faebc34299e6ab6bf485 |
| S-119 | listTaskReviewersFn | /_serverFn/b2339f8c69ed91a91eec2b995fec7f10750e9410a859a25be73835e3cb4b9648 |
| S-120 | setTaskReviewersFn | /_serverFn/c86b73934bd0fa51a4d2813126a7e410b14de7567f855dc8486024fceb099e0c |
| S-121 | listOpenRisksFn | /_serverFn/9191eb08023a68798d891715c7b6afbe59fb3b5e1313f5b43c3c686e7a940a72 |
| S-122 | resolveRiskFn | /_serverFn/5fdfafb60561f3f006d55814cd2322be82e0a5e233b2ff7b5800b8289b96c1d6 |
| S-123 | listMyEodTasksFn | /_serverFn/2f7bc3950e0ebd5ba6b9a0fb41a5697493ceff280341ac0799fe490bebfb755d |
| S-124 | upsertTaskEodFn | /_serverFn/3b7e872fc80f72341ab590ab6a25fc154f9286ad4414af1f94f9a64af1132c4b |
| S-125 | listEodForDateFn | /_serverFn/d5788ffc555da211bd51cc3781f427f8b1f18f7a897a3939c8d3ce99b9bb56ce |
| S-126 | acknowledgeEodFn | /_serverFn/e5aa954f8b74e996cde9f2ff062a87db2fc742998799d87bd4b84db809eb58d9 |
| S-127 | fetchTaskNameHintsFn | generated /_serverFn/<sha256 hash> (function absent from the stale dist build) |
| S-128 | createTaskFn | /_serverFn/879196c2e2f714d7c18bc7aaadd60de3030d579a959353b42f55a0265d20a305 |
| S-129 | updateTaskFn | /_serverFn/475ddaf9b7530815bde770d31b73f427b7477ae9962585c56c8e350ce37c1aea |
| S-130 | notifyTaskBlockedFn | /_serverFn/b62abd1cb4203dd0b3a06ad71074e759465cf76dd0226981963cb353e34eda22 |
| S-131 | insertAssignmentNotificationFn | /_serverFn/7ef4d50db7ff30815ced1384dbbe569ac781363677173aeb708035b197b77407 |
| S-132 | addTaskCommentHistoryFn | /_serverFn/52a42617d579e932e5828fc7f687450127e240e3008c90f6581179d066e43cd1 |
| S-133 | deleteTaskFn | /_serverFn/a5f8301b2a7f8fbdc12cf120e0af24f6cb948ee1bcb1d7e4bba69b2968b95358 |
| S-134 | listTemplatesFn | /_serverFn/e0a23e436a609bb67f0e6c62e07bf977d956f657547be4fb2408618c7462ff58 |
| S-135 | listTemplateComponentsFn | /_serverFn/e1206586af015b7ed17d1def772b3f6e5a4f5c0e60591fdea3adcaeb38d1f6af |
| S-136 | installTemplateFn | /_serverFn/28a1b3101f7ca26d2246ffd517809f1b61882a0956702177c39906a51b56a50d |
| S-137 | listWorkItemTypesFn | /_serverFn/5c17056c881bb7a66156d02cf9c8bb699ff2464f4c537416e0dc2e46fb3808f0 |
| S-138 | createWorkItemTypeFn | /_serverFn/8532de8f73b56f0aaca42580f9c3ac1a086587712fcc7860515dd6105cfc520c |
| S-139 | updateWorkItemTypeFn | /_serverFn/a4dcb4fbfe65022172883e365a565d02bb6a7be7b105951f79a0d3cb602a76a7 |
| S-140 | setWorkItemTypeActiveFn | /_serverFn/486e5fcbd7b6234e565693310ecc9b8445542012e09a6d875b0662d0f0e923c5 |
| S-141 | listStatusesFn | /_serverFn/95732cc16b9fb5b229d9e51535acf80d526ec158d2b7d007ddd94a241e489c22 |
| S-142 | listTransitionsFn | /_serverFn/25fe0c58f72c121c2838b600dc14b519a16e29a664b234cd859f615c6a3fb924 |
| S-143 | upsertWorkloadSnapshotsFn | /_serverFn/9a0f2a7b35f780f834d4398d4629d0e7856da61c47b24bb7a9b7f144e114da0f |

Functions absent from the dist build (10): seedQaAccounts, markNotificationReadFn, markAllNotificationsReadFn, fetchActiveNudges, markNudgeRead, dismissNudge, listRelationsFn, linkRelationFn, unlinkRelationFn, fetchTaskNameHintsFn.

### 1B. Non-serverFn HTTP route handlers (createFileRoute `server.handlers`)

There is no `src/routes/api/*` file with a serverFn; the 15 api routes + 2 storage routes below are plain handlers. "Auth" is what the code checks.

| ID | Method path | file:line | Auth (code) | Tables / calls | SQL per call | Triggered by (callers found in code) |
|---|---|---|---|---|---|---|
| R-01 | POST /api/public/hooks/adoption-rollup | src/routes/api/public/hooks/adoption-rollup.ts:9 | requireCronAuth (x-cron-secret + timestamp + nonce, 30 s per-route rate limit via cron_invocations) | RPC adoption rollup (supabaseAdmin.rpc, :15) + cron_invocations | auth: 1 count + 1 insert + 1 delete(GC) ; body: 1 RPC | External scheduler (pg_cron per comment in lib/cron-auth.server.ts:1-4 / docs). No scheduler definition in repo. |
| R-02 | POST /api/public/hooks/automation-due-enqueue | src/routes/api/public/hooks/automation-due-enqueue.ts:17 | requireCronAuth | R tasks (2 selects :25,:48); RPC enqueue_automation_event per task (loop :30-37, :53-60) | auth 3 + 2 SELECT + 1 RPC per due/missed task (N+1 loop) | External scheduler; code comment: every 15 min (due.reached) and daily 02:00 UTC (due.missed) (:10-13). |
| R-03 | POST /api/public/hooks/automation-tick | src/routes/api/public/hooks/automation-tick.ts:13 | requireCronAuth | runAutomationTick() (lib/automation/worker.server.ts): drains approval outbox + automation_events | auth 3 + worker: Not measured | External scheduler; code comment "every 30 seconds" (:7), docs/PHASE_D_AUTOMATION_DESIGN.md:116,359. Note: requireCronAuth rate-limits to 1 call / 30 s per route (cron-auth.server.ts:RATE_WINDOW_MS) so a tick landing less than 30 s after the previous one is rejected with 429. |
| R-04 | POST /api/public/hooks/carry-forward | src/routes/api/public/hooks/carry-forward.ts:15 | requireCronAuth | RPC next_working_day (:22); R tasks (:36); RPC carry_task_forward per overdue task (loop :52-60) | auth 3 + 2 + 1 per overdue task (N+1 loop) | External scheduler; comment "daily, e.g. 02:00" (:7). |
| R-05 | POST /api/public/hooks/detect-risks | src/routes/api/public/hooks/detect-risks.ts:12 | requireCronAuth | RPC detect_risks (:15) | auth 3 + 1 RPC | External scheduler (daily ~07:00 per comment :7). ALSO the UI button: services/risks.ts:33 (POST with no cron headers) via command.tsx:106 -> would be rejected 401 by requireCronAuth. |
| R-06 | POST /api/public/hooks/evening-digest | src/routes/api/public/hooks/evening-digest.ts:24 | requireCronAuth UNLESS query `?force=true` (then NO auth, :26-30) | R profiles, tasks, notification_prefs, work_settings (4 parallel supabaseAdmin selects :59-72, NO LIMIT); W notifications (insert per profile loop :259-278, per manager :335-354; dedupe select :326); sends emails (sendEodEmail per user) | 4 + N inserts + N emails (loops) | External scheduler / cron-ticker (lib/cron-ticker.server.ts evening branch is inline, does not call this URL). |
| R-07 | POST /api/public/hooks/generate-nudges | src/routes/api/public/hooks/generate-nudges.ts:9 | requireCronAuth | RPC generate_nudges (:12) | auth 3 + 1 RPC | External scheduler; client fn nudgesService.generateNow (services/nudges.ts:18) has NO caller. |
| R-08 | POST /api/public/hooks/morning-digest | src/routes/api/public/hooks/morning-digest.ts:19 | requireCronAuth UNLESS `?force=true` (:21-27) | R profiles, tasks, notification_prefs, work_settings (4 parallel selects :52-61, NO LIMIT); W notifications (loop :102-152, managers :171-184); emails | 4 + N inserts + N emails | In-process cron ticker: lib/cron-ticker.server.ts:94 (`fetch(APP_URL/api/public/hooks/morning-digest?force=true)` at configured morning time, once/day key, started from src/server.ts:14); external scheduler. |
| R-09 | POST /api/public/hooks/no-tasks-reminder | src/routes/api/public/hooks/no-tasks-reminder.ts:16 | requireCronAuth UNLESS `?force=true` (:18-24) | R profiles, tasks, notification_prefs, work_settings, notifications (5 parallel selects :57-68, NO LIMIT); W notifications (loop :150-164) | 5 + N inserts | External scheduler (interval from work_settings.no_tasks_reminder_interval). |
| R-10 | POST /api/public/hooks/planning-suggestions | src/routes/api/public/hooks/planning-suggestions.ts:9 | requireCronAuth | RPC (planning suggestions generator, :12) | auth 3 + 1 RPC | External scheduler (nightly 18:00 per SuggestionsPanel text); UI button services/planning-suggestions.ts:24 via SuggestionsPanel.tsx:43 sends `apikey` header only -> rejected 401 by requireCronAuth. |
| R-11 | POST /api/public/hooks/workload-snapshot | src/routes/api/public/hooks/workload-snapshot.ts:13 | requireCronAuth | R tasks `select *` (NO filter, NO LIMIT :19), profiles (active); W daily_workload_snapshot upsert (:72) | auth 3 + 2 + 1 upsert batch | External scheduler (nightly). |
| R-12 | GET /api/public/actions/carry-forward-task | src/routes/api/public/actions/carry-forward-task.ts:73 | NONE beyond query params taskId+userId; checks tasks.assigned_to === userId (:102) - userId is caller-supplied | R tasks, SELECT next_working_day(), carry_task_forward() (pool.query, no RLS) | 3 | Link inside emails (services/email-templates.ts:439). |
| R-13 | GET /api/public/actions/complete-task | src/routes/api/public/actions/complete-task.ts:73 | NONE beyond taskId+userId query params (assigned_to check :102) | R tasks; W tasks, task_history (pool.query) | 3-4 | Link inside emails (email-templates.ts:438). |
| R-14 | GET /api/public/actions/start-task | src/routes/api/public/actions/start-task.ts:70 | NONE beyond taskId+userId query params (assigned_to check :107) | R tasks; startTaskForUser() (lib/task-start.server.ts) W tasks, task_worklogs, history | 2 + startTaskForUser: Not measured | Link inside emails (email-templates.ts:601). |
| R-15 | POST /api/public/actions/push-start-task | src/routes/api/public/actions/push-start-task.ts:34 | signed expiring one-time token (verifyPushAction, markActionRedeemed) | startTaskForUser (tasks/history), pushTaskProgress | Not measured | Android push notification "Start Task" button. |
| R-16 | GET /app-storage/file | src/routes/app-storage/file.ts:24 | HMAC token+expiry in query (secret = CRON_SECRET or hard-coded fallback "default-fallback-storage-secret", :5-7) | R attachments (adminQuery, file bytes) | 1 | Browser fetches the URL returned by getDownloadUrlFn (S-001). |
| R-17 | POST /app-storage/upload | src/routes/app-storage/upload.ts:19 | NONE in handler (userId from form field) | W attachments (adminQuery INSERT..ON CONFLICT :41; ALTER TABLE ADD COLUMN IF NOT EXISTS once/process :9) or Supabase storage | 1 (+1 DDL once) | storage.upload client (integrations/backend/storage.ts:86) <- attachmentsService.upload, offline-queue.ts photo.upload. |

Non-HTTP server loops started in src/server.ts (not routes): `startBackgroundCronTicker()` (setInterval 60 s, :14) runs per tick `promoteDueTentativeLeaves` (1 UPDATE), `checkIsWorkingDayServer` and 1 PostgREST `work_settings` select, then fires morning/evening/manager digests at configured minute; `startNotificationListener()`, `startOutboxListener()` (LISTEN/NOTIFY -> Socket.IO). Not skipped in read-only mode: listeners.
Cron endpoints rely on `requireCronAuth` (src/lib/cron-auth.server.ts:28-): per call 1 count query + 1 insert (+1 fire-and-forget DELETE of rows >24 h) before the actual work.

### 2. Page-wise grouping (route -> serverFns invoked)

Routes are under src/routes/_authenticated/. Format: trigger -> `S-id function`. Shared mounts first because they run on every authenticated page.

**Global/shell (routes/_authenticated.tsx + components/AppShell.tsx; every authenticated page load)**
- mount: S-012 fetchActiveAnnouncements + S-096 listHolidaysFn (HolidayBanner.tsx:67-91; AppShell.tsx:544; no cache)
- mount (once/page load, unless sessionStorage dismissed key): S-066 checkUnstartedTasksTodayFn (UnstartedTaskLeaveModal.tsx:31; routes/_authenticated.tsx:111)
- mount (store guard, once/session): S-068 listNotebookNotesFn (notesStore.ts:112 via useNotes in DockNotepadBar/DraggableNotepadModal, AppShell.tsx:786-790)
- click: S-077 markNotificationReadFn, S-078 markAllNotificationsReadFn (use-notifications.tsx:417,431; provider routes/_authenticated.tsx:108)
- click/native: S-050 registerDeviceTokenFn (use-native-app.ts:29), S-051 unregisterDeviceTokenFn (AppShell.tsx:250 on logout)
- click: S-047 submitDemoFeedback (GlobalFeedbackWidget.tsx:14, AppShell.tsx:785; InteractiveFigmaDemoModal via AnnouncementNoticeBanner.tsx:86)
- open (global TaskFormDialog AppShell.tsx:798): S-127 fetchTaskNameHintsFn (cached 5 min), S-137 listWorkItemTypesFn (cached 5 min), S-096 listHolidaysFn (cached 5 min), S-060 fetchLeavesFn (cached 60 s), S-052 listFieldDefsFn (per type), S-119 listTaskReviewersFn, S-021 listAttachmentsFn, S-036 listCommentsFn+S-037 listMentionableUsersFn (CommentsPanel), S-021 listAttachmentsFn again via AttachmentsPanel; click: S-128 createTaskFn, S-129 updateTaskFn, S-022 insertAttachmentMetaFn
- open (GlobalCompleteTaskEodDialog / GlobalReviewSubmitDialog): S-123 listMyEodTasksFn (ReviewSubmitDialog.tsx:73); click: S-124 upsertTaskEodFn, S-114 submitForReviewFn, S-115 logReviewHoursFn, S-022 insertAttachmentMetaFn

**/my-day (my-day.tsx)**
- mount + RT + focus: S-009 getMyDay (useQuery, staleTime 2 min, my-day.tsx:298; RT tasks(assignee)/risk_events/approval_requests debounced 800 ms)
- mount: S-053 getEodTodayFn + S-072 getNotifPrefsFn (EodReminder.tsx:19-20, my-day.tsx:726)
- click via TaskCard / TaskDetailModal / TaskQuickActionModal / KanbanBoard: S-129 updateTaskFn (start/pause/resume/transfer/priority), S-133 deleteTaskFn, S-033 carryForwardWithTimerFn, S-124 upsertTaskEodFn, S-130 notifyTaskBlockedFn, S-114 submitForReviewFn, S-116 decideReviewFn, S-117 listTaskReviewsFn (ReviewInfo + useReviewDecisions duplicate)
- open (TaskDetailModal/TaskHistorySheet): S-021 listAttachmentsFn, S-036 listCommentsFn, S-037 listMentionableUsersFn, S-137 listWorkItemTypesFn (TaskHistorySheet.tsx:97), S-001 getDownloadUrlFn
- click: S-054 upsertEodFn, S-034 listOverdueForUserFn+S-032 carryTaskForwardFn (EodCheckInSheet.tsx:65,76)

**/tasks (tasks.tsx)**
- click bulk: S-133 deleteTaskFn xN (Promise.all, tasks.tsx:495), S-129 updateTaskFn xN (:527,:547), S-128 createTaskFn xN (:565); CSVImportDialog.tsx:666,673: S-129 updateTaskFn/S-128 createTaskFn per CSV row (Promise.all); TaskCard/TaskDetailModal actions as above

**/blockers, /calendar (TaskCard hosts)**
- /calendar mount: S-060 fetchLeavesFn (unfiltered, calendar.tsx:140) + S-096 listHolidaysFn (:141); RT leaves: S-060 fetchLeavesFn (:163); click: S-062 updateLeaveStatusFn, S-064 deleteLeaveFn; LeaveDialog: S-096 listHolidaysFn (open), S-061 createLeaveFn, S-063 updateLeaveDetailsFn; MyLeaveReportDialog: S-060 fetchLeavesFn (user+year)
- /blockers: TaskCard actions only (click)

**/leaves (leaves.tsx)**
- mount: S-060 fetchLeavesFn (unfiltered, :61); click: S-062 updateLeaveStatusFn, S-064 deleteLeaveFn, LeaveDialog fns, S-067 quickMarkLeaveTodayFn (via modal)

**/executive (executive.tsx)**
- mount: S-006 getExecScope (staleTime Infinity), S-005 getExecSummary (staleTime 30 s; RT tasks -> refetch after 1000 ms), S-060 fetchLeavesFn (today/__all, realtimeCovered; RT leaves)

**/manager (manager.tsx)**
- mount + RT: S-008 getManagerCommand (staleTime 30 s; RT tasks/risk_events/approval_requests)

**/forecast (forecast.tsx)**
- mount: S-007 getForecast (no cache, no realtime)

**/command (command.tsx)**
- mount + RT tasks (all): S-121 listOpenRisksFn + S-085 getWorkSettingsFn (inside load(), command.tsx:42-43,52); RT risk_events: S-121 listOpenRisksFn (:58); click: S-122 resolveRiskFn; TomorrowRiskPanel mount: S-110 fetchTomorrowRisks; SuggestionsPanel mount + RT planning_suggestions: S-108 fetchOpenSuggestions; click: S-109 resolveSuggestion, S-032 carryTaskForwardFn, S-129 updateTaskFn

**/planning-suggestions (planning-suggestions.tsx)**
- mount: S-108 fetchOpenSuggestions (+RT), S-110 fetchTomorrowRisks

**/planning (planning.tsx)**
- click bulk (sequential loops): S-032 carryTaskForwardFn xN (:95), S-129 updateTaskFn xN (transfer :79, priority :87)

**/eod (eod.tsx)**
- mount + RT eod_checkins: S-055 listEodForDateFn (eod service, :85, :136); click: S-034 listOverdueForUserFn + S-032 carryTaskForwardFn (carry-all loops over EVERY profile, :232-236), S-143 upsertWorkloadSnapshotsFn (:264)

**/eod-tasks (eod-tasks.tsx)**
- mount + after submit: S-123 listMyEodTasksFn (:64); click: S-124 upsertTaskEodFn (:124)

**/dashboard (dashboard.tsx)**
- mount: S-055 listEodForDateFn (task-eod variant, TaskEodReviewCard.tsx:23); click: S-126 acknowledgeEodFn

**/reviews (reviews.tsx)**
- mount + RT tasks(all) + RT task_review_decisions: S-118 listReviewQueueFn (:37); ReviewInfo mount: S-117 listTaskReviewsFn; click: S-116 decideReviewFn

**/intelligence (intelligence.tsx)**
- mount: S-059 fetchIntelligenceBundle, S-011 fetchAdoptionLast14 (:41-42)

**/team-capacity (team-capacity.tsx)**
- mount: S-060 fetchLeavesFn (today/__all; RT leaves)

**/time-tracking, /workload, /heatmap, /analytics, /reports, /notebook, /today, /sync, /desktop-hub, /notifications**
- /heatmap click: S-143 upsertWorkloadSnapshotsFn (heatmap.tsx:61); no other serverFn call-site found in these route files (they use PostgREST/supabase client reads); shell calls apply

**/exports (exports.tsx)**
- click Generate: S-058 getMonthlyCapacityReportFn (:258)

**/admin (admin.tsx)**
- mount: S-013 fetchAllAnnouncements (:26-27); DemoFeedbackDashboard mount: S-048 fetchDemoFeedbackStats; click: S-014 createAnnouncement, S-015 deleteAnnouncement, S-004 updateUserAdminSettings, S-003 deleteUser

**/settings/operations (settings.operations.tsx)**
- mount (Promise.all): S-089 listTeamsFn, S-092 listProjectsFn, S-096 listHolidaysFn, S-085 getWorkSettingsFn (:152); click: S-086 updateWorkSettingsFn, S-090 createTeamFn, S-091 deleteTeamFn, S-093 createProjectFn, S-095 deleteProjectFn, S-097 addHolidayFn (loop on import), S-098 removeHolidayFn

**/settings/email-operations**
- mount: S-085 getWorkSettingsFn + S-072 getNotifPrefsFn (:86); click: S-086 updateWorkSettingsFn, S-073 saveNotifPrefsFn, S-076 dispatchMorningNudgeTestEmailFn, S-075 dispatchMemberEodTestEmailFn, S-074 dispatchEodTestEmailFn

**/settings/notifications**
- mount: S-072 getNotifPrefsFn (:36); click: S-073 saveNotifPrefsFn, S-074 dispatchEodTestEmailFn

**/onboarding (onboarding.tsx)**
- mount: S-082 getOnboardingFn, S-134 listTemplatesFn, S-137 listWorkItemTypesFn (:41-43); click: S-083 setOnboardingStepFn then S-082 getOnboardingFn + S-137 listWorkItemTypesFn again, S-136 installTemplateFn, S-139 updateWorkItemTypeFn

**/configure (configure.tsx tabs)**
- health tab: none (configure/HealthPanel has no serverFn call)
- templates: S-134 listTemplatesFn + S-135 listTemplateComponentsFn per template (N+1), preview S-135 listTemplateComponentsFn, click S-136 installTemplateFn
- types: S-137 listWorkItemTypesFn + per type S-141 listStatusesFn + S-142 listTransitionsFn (N+1); click S-140 setWorkItemTypeActiveFn, S-138 createWorkItemTypeFn, S-139 updateWorkItemTypeFn
- statuses: S-137 listWorkItemTypesFn, S-141 listStatusesFn; workflow: S-137 listWorkItemTypesFn, S-141 listStatusesFn, S-142 listTransitionsFn, S-052 listFieldDefsFn, S-099 listOrgRolesFn (RoleSelect), S-099 listOrgRolesFn; fields: S-137 listWorkItemTypesFn
- roles: S-099 listOrgRolesFn, S-102 listOrgRoleHierarchyFn; click S-100 createOrgRoleFn, S-101 updateOrgRoleFn, S-103 setOrgRoleParentFn, S-104 listOrgRoleMembersFn, S-105 assignOrgRoleFn, S-106 unassignOrgRoleFn
- approvals: S-137 listWorkItemTypesFn, S-016 listChainsForTypeFn, S-052 listFieldDefsFn, S-017 listApprovalStepsFn
- versions: S-043 listConfigSnapshotsFn; click S-044 snapshotConfigFn, S-045 restoreConfigFn, S-046 deleteConfigSnapshotFn
- io: click S-041 fetchCurrentConfigFn (x2 on export+preview), S-042 importConfigFn

**/configure/new (configure.new.tsx)**
- click: S-138 createWorkItemTypeFn (:143); TypePreviewSheet open: S-052 listFieldDefsFn, S-141 listStatusesFn, S-142 listTransitionsFn, S-016 listChainsForTypeFn, S-017 listApprovalStepsFn per chain (N+1)

**/configure/automations (configure.automations.tsx)**
- rules tab mount: S-024 listAutomationRulesFn, S-137 listWorkItemTypesFn; runs tab mount: S-029 listAutomationRunsFn + S-024 listAutomationRulesFn; health tab: S-031 automationHealthFn (mount + RT automation:health); click: S-026 createAutomationRuleFn, S-027 updateAutomationRuleFn, S-028 deleteAutomationRuleFn, S-030 replayAutomationRunFn, S-137 listWorkItemTypesFn (editor drawer)

Server functions with NO client call-site (unused): see findings F-1.

### 3. Findings (file:line evidence)

### F-1 Server functions never called from client (24 of 143)

- S-010 seedQaAccounts
- S-018 startApprovalRequestFn
- S-019 decideApprovalFn
- S-020 listApprovalsForWorkItemFn
- S-025 getAutomationRuleFn
- S-035 listCarryEventsForTaskFn
- S-049 clearAllDemoFeedback
- S-056 buildExportRowsFn
- S-057 recordExportFn
- S-065 checkAndNotifyTomorrowLeavesFn
- S-079 fetchActiveNudges
- S-080 markNudgeRead
- S-081 dismissNudge
- S-084 resetOnboardingFn
- S-087 getStreakForUserFn
- S-088 listAllStreaksFn
- S-094 updateProjectFn
- S-107 myOrgRoleKeysFn
- S-111 listRelationsFn
- S-112 linkRelationFn
- S-113 unlinkRelationFn
- S-120 setTaskReviewersFn
- S-131 insertAssignmentNotificationFn
- S-132 addTaskCommentHistoryFn

Evidence: no import/usage outside the defining `*.functions.ts` and its thin wrapper in src/services/*.ts (greps over src and tests). Dead-wrapper cases: services/approvals.ts:65,76,82; automations.ts:66; carry-forward.ts:69; leaves.ts:58; operations.ts:33,36,60; org-roles.ts:63; relations.ts:13-25; reviews.ts:83; tasks.ts:20,282; onboarding.ts:53. Components never rendered: components/NudgeCenter.tsx (nudges x3), components/StreakChip.tsx (getStreakForUserFn). lib/qa-seed.functions.ts, exports buildExportRowsFn/recordExportFn, clearAllDemoFeedback have no wrapper or caller at all. Several of these are also unguarded writes (clearAllDemoFeedback = TRUNCATE with adminQuery and no role check, demo-feedback.functions.ts:134-138).

### F-2 High-traffic functions (realtime event or reconnect driven)

Every Socket.IO event coalesced at 250 ms leading+trailing triggers the callbacks below; callbacks also fire on reconnect and when a hidden tab becomes visible (use-realtime-refresh.ts header, channel.ts:197).
- S-008 getManagerCommand: refetch on ANY tasks / risk_events / approval_requests event (manager.tsx:28-33), 10 PostgREST calls each, unbounded reads (manager.functions.ts:159-163,187). No debounce besides 250 ms.
- S-009 getMyDay: refetch on tasks(assignee)/risk_events/approval_requests events, 800 ms debounce (my-day.tsx:311-318,344-355) + refetchOnWindowFocus true (:304) after 2 min stale; 4-10 PostgREST calls. Also invoked indirectly from ~12 child `onChanged` callbacks (my-day.tsx:587-911).
- S-005 getExecSummary: refetch on every org-wide tasks event (1000 ms trailing, executive.tsx:303-311); heavy SECURITY DEFINER rollup function (tables listed in row), cost Not measured.
- S-118 listReviewQueueFn: reviews.tsx:57-61 reloads the whole queue (+ loadPeopleSafe) on every org-wide tasks event and every task_review_decisions event; the queue has no LIMIT.
- S-121 listOpenRisksFn + S-085 getWorkSettingsFn: command.tsx:38-52 `load()` (also reloads all tasks and profiles) runs on every tasks event; risks again on each risk_events event (command.tsx:58). work_settings is a single rarely changing row refetched each time.
- S-108 fetchOpenSuggestions: SuggestionsPanel.tsx:28-34 on every planning_suggestions event; the panel is rendered twice when both /command and /planning-suggestions content is shown to a manager, and non-managers still fetch before the `return null` guard (:38).
- S-055 listEodForDateFn (eod): eod.tsx:136 on every eod_checkins event.
- S-060 fetchLeavesFn: leaves RT events on calendar.tsx:163, executive.tsx (realtimeCovered + leaves RT, :318), team-capacity.tsx:321. Each call may also run the throttled UPDATE promoteDueTentativeLeaves.
- S-031 automationHealthFn: HealthPanel.tsx:22-26 on socket event automation:health, resync, and safety refresh while disconnected.
- No `refetchInterval`/client `setInterval` drives any serverFn (grep). Timed server work: cron-ticker 60 s loop (cron-ticker.server.ts:41-47 promoteDueTentativeLeaves + work_settings select per tick = about 2-3 statements/minute at idle).

### F-3 Duplicates (same call from multiple pages/components)

- S-060 fetchLeavesFn unfiltered `getLeaves()`: calendar.tsx:140, leaves.tsx:61, task-form-options.ts:128 (cached 60 s); identical today-only query {startDate,endDate,status:"__all"}: executive.tsx:262 and team-capacity.tsx:310 (separate query keys exec-active-leaves / capacity-active-leaves, no sharing).
- S-096 listHolidaysFn: HolidayBanner.tsx:85 (shell, every load), calendar.tsx:141, LeaveDialog.tsx:82 (each open), settings.operations.tsx:152, task-form-options.ts:125 (5 min cache). Not shared with the shell call.
- S-137 listWorkItemTypesFn: 10+ call sites (TaskHistorySheet.tsx:97 per sheet open, configure panels, RuleEditorDrawer.tsx:73, RulesPanel.tsx:41, onboarding.tsx:43,58, task-form-options.ts:122 cached) - only the task form is cached.
- S-085 getWorkSettingsFn: command.tsx:43, settings.operations.tsx:152, settings.email-operations.tsx:86.
- S-024 listAutomationRulesFn: RulesPanel.tsx:23 and RunsTable.tsx:31 (both tabs) ; S-099 listOrgRolesFn per RoleSelect instance (RoleSelect.tsx:16) plus RolesPanel.tsx:30.
- S-117 listTaskReviewsFn: ReviewInfo.tsx:114 and use-review-decisions.ts:24 both call listForTask(taskId).
- S-021 listAttachmentsFn: TaskFormDialog.tsx:237 plus AttachmentsPanel.tsx:42 rendered inside the same form (TaskFormDialog.tsx:2055); TaskDetailModal.tsx:153 plus AttachmentsPanel in TaskHistorySheet.tsx:233.
- S-037 listMentionableUsersFn: CommentsPanel.tsx:71 on every CommentsPanel mount; the list is global (all active profiles), uncached.
- S-072 getNotifPrefsFn: EodReminder.tsx:19, settings.notifications.tsx:36, settings.email-operations.tsx:86.
- S-123 listMyEodTasksFn: ReviewSubmitDialog.tsx:73 fetches the full EOD list to find one task, same call as eod-tasks.tsx:64.
- S-052 listFieldDefsFn: TaskFormDialog.tsx:530 on every open, WorkflowPanel.tsx:40, ApprovalsPanel.tsx:47, TypePreviewSheet.tsx:46 (no cache).
- S-002 deleteObjectsFn after S-023 deleteAttachmentMetaFn (attachments.ts:81-82): second request deletes the same attachments row (storage.ts:56-58).

### F-4 Functions issuing many SQL statements per call / N+1 / loops

- S-003 deleteUser: about 19-23 round trips and 2 DDL statements (CREATE OR REPLACE FUNCTION auth.uid() and public.log_task_change()) on every invocation (admin-actions.ts:33,53).
- S-047 submitDemoFeedback: CREATE TABLE IF NOT EXISTS on every call (demo-feedback.functions.ts:30).
- S-042 importConfigFn: one statement per config row inside for loops (config-io.functions.ts:63-190). S-143 upsertWorkloadSnapshotsFn: one INSERT per row (workload.functions.ts:25-45). S-065: nested loops of INSERTs (leaves.functions.ts:547-557). S-061/S-067: INSERT per manager recipient.
- S-041 fetchCurrentConfigFn 8+5tx; S-008 getManagerCommand 10 HTTP calls; S-007 getForecast 11 HTTP calls; S-009 4-10; S-058 7+5tx; S-031 5+5tx; S-059 5+5tx; S-129 updateTaskFn ~3-12+5tx plus DB triggers and an after-commit push.
- Client-side fan-out (one HTTP serverFn call per item): tasks.tsx:495 (deleteTaskFn xN), tasks.tsx:527/547 (updateTaskFn xN), tasks.tsx:565 (createTaskFn xN), CSVImportDialog.tsx:666-673 (per CSV row), TaskFormDialog.tsx:794,847 (create per grid row / per assignee), planning.tsx:79-96 and carry-forward.ts:52-62 (sequential per-task), eod.tsx:232-236 (listOverdueForUserFn + carry per task for EVERY profile, sequential).
- N+1 on config pages: TemplatesPanel.tsx:25-28 (components per template), TypesPanel.tsx:25-33 (statuses+transitions per type), TypePreviewSheet.tsx:51 (steps per chain).

### F-5 Functions without LIMIT (unbounded result sets)

- Entire-table / near-entire reads: fetchIntelligenceBundle (`SELECT * FROM tasks`, no WHERE, intelligence.functions.ts:29), getManagerCommand and getForecast (all projects, open risks, approval_requests, approval_steps, all tasks of in-scope members), fetchCurrentConfigFn (8 tables SELECT *), dispatchEodTestEmailFn (all active profiles + all tasks), fetchDemoFeedbackStats (all rows, no admin check), listMentionableUsersFn (all active profiles incl. email), listAllStreaksFn, fetchAllAnnouncements, listAutomationRulesFn, listTeamsFn, listProjectsFn, listHolidaysFn, listTemplatesFn, listWorkItemTypesFn, listOrgRolesFn, listOrgRoleHierarchyFn, listOpenRisksFn, fetchOpenSuggestions, fetchLeavesFn (unfiltered), listReviewQueueFn, listEodForDateFn (both), listNotebookNotesFn (images jsonb), listAttachmentsFn / listCommentsFn (per item), listOverdueForUserFn (`SELECT *`).
- Bounded: getMyDay tasks LIMIT 400; fetchTaskNameHintsFn LIMIT 1000; listConfigSnapshotsFn LIMIT 50; listAutomationRunsFn LIMIT 100 (max 1000); fetchActiveNudges LIMIT 20; recent approvals LIMIT 500 / 1000; completed tasks LIMIT 2000 (forecast). Actual PostgREST server-side max-rows setting: not found in repo (infra compose has no PGRST_DB_MAX_ROWS) - effective cap on `context.supabase` reads: Not measured.

### F-6 Access-control / robustness observations seen while reading handlers (not performance)

- Handlers that use RLS-bypassing access with no role/ownership check: listMentionableUsersFn (adminSelect, returns every active user email), fetchDemoFeedbackStats, clearAllDemoFeedback (TRUNCATE), deleteObjectsFn (adminQuery delete by path), fetchLeavesFn (pool.query, no userId restriction), dispatchEodTestEmailFn. Public GET email-action routes trust a caller-supplied userId (R-12..R-14); /app-storage/upload has no auth check; /app-storage/file falls back to a hard-coded HMAC secret when CRON_SECRET is unset; `?force=true` bypasses requireCronAuth on morning-digest, evening-digest, no-tasks-reminder.
- UI buttons call cron hooks without cron headers (services/risks.ts:33, planning-suggestions.ts:24): requireCronAuth would return 401, so the buttons cannot succeed against these routes as coded.
- fetchCompanyHolidays reads `public.holidays` (leaves.server.ts:152) whereas the holiday list function reads `public.holiday_calendar` (operations.functions.ts:213): table name mismatch (the catch returns [] silently).
- Stale build: dist/server manifest lacks 10 current serverFns (ids marked in 1A), so endpoint hashes must be re-read after rebuild.

### 4. Exact totals

| Metric | Count |
|---|---|
| `createServerFn` grep lines in src (incl. imports, README) | 187 |
| `createServerFn(` call sites | 144 |
| commented-out call sites | 1 |
| **live server functions (rows S-001..S-143)** | **143** |
| GET | 51 |
| POST | 92 |
| with requireSupabaseAuth middleware | 143 (100%) |
| files defining serverFns | 42 |
| ids found in dist manifest | 133 (absent: 10) |
| serverFns with no client call-site | 24 |
| serverFns with at least one client call-site | 119 |
| serverFns invoked by realtime events (RT-driven refetch) | 10 |
| serverFns invoked by interval / refetchInterval | 0 |
| non-serverFn HTTP handlers (routes) | 17 (11 hooks, 4 actions, 2 app-storage) |
| useServerFn direct hooks in components/routes | 14 (admin.tsx x5, executive.tsx x2, forecast, manager, my-day, HolidayBanner, GlobalFeedbackWidget, InteractiveFigmaDemoModal, DemoFeedbackDashboard) |

Per-file count: integrations/backend/storage.ts=2, lib/admin-actions.ts=2, lib/executive=2, lib/forecast=1, lib/manager=1, lib/my-day=1, lib/qa-seed=1, adoption=1, announcements=4, approvals=5, attachments=3, automations=8, carry-forward=4, comments=5, config-io=2, config-snapshots=4, demo-feedback=3, device-tokens=2, dynamic-fields=1, eod=3, exports=3, intelligence=1, leaves=8, notebook=4, notif-prefs=5, notifications=2, nudges=3, onboarding=3, operations=14, org-roles=9, planning-suggestions=2, predictions=1, relations=3, reviews=7, risks=2, task-eod=4, task-form-hints=1, tasks=6, templates=3, work-item-types=4, workflow=2, workload=1.


---

# Part C — Realtime (Socket.IO), background work, infra, other clients


Scope: static read-only audit of `C:\Users\sumit\Downloads\Daily Flow Postgres` (working tree on branch fix/api_call_pattern_changed, uncommitted edits included). Nothing was run or measured. "Frequency" is derived from code only; "Data size" is "Not measured" unless the code bounds it. All line numbers were verified by reading the files. Paths are relative to the project root.

Conventions: PostgREST = HTTP via `supabase.from(...)` (browser) or `supabaseAdmin` (server, via SUPABASE_URL). "pg" = direct node-postgres query on the pool (max 10, `src/integrations/postgres/client.server.ts:26`). "server fn" = TanStack createServerFn POST.

---------------------------------------------------------------------------------------------------

### 0. Totals (exact, code-derived)

| Metric | Count |
|---|---|
| Socket.IO client->server events | 2 (`resync`, `auth:refresh`) |
| Socket.IO server->client app events | 5 (`entity:changed`, `notification:new`, `notification:read`, `automation:health`, `auth:expired`); `auth:expired` has no client listener |
| Client `supabase.channel(` call sites in src (outside integrations/realtime) | 9 (use-realtime-tasks, use-realtime-refresh, use-review-decisions, my-day-cache, NudgeCenter, SuggestionsPanel, MorningResumePromptModal, command.tsx risk-rt, dashboard.tsx) |
| Subscription sites inventoried (R-010..R-038) | 29 (28 live, 1 dead: NudgeCenter) |
| Hook-level consumers: `useRealtimeTasks` | 10 pages (blockers, calendar, command, eod-tasks, eod, my-day, planning, reviews, tasks, workload) |
| Hook-level consumers: `useRealtimeRefresh` | 9 call sites (calendar, eod, executive x3, manager, my-day, team-capacity x2) |
| Always-on subscriptions in the authenticated shell (every page) | 3 channels (MorningResume, shell review-decisions, my-day-freshness) = 6 table subscriptions for a member, 8 for a manager (+ NotificationsProvider's raw socket handlers) |
| Routes with at least one realtime subscription beyond the shell | 14 route files (see section 5) |
| Routes with NO realtime subscription | admin, intelligence, heatmap, time-tracking, settings.operations, notebook, exports, configure (except HealthPanel tab), etc. |
| Server background loops/timers (always on) | 3: cron ticker 60 s (`cron-ticker.server.ts:46`), outbox heartbeat 30 s (`outbox-listener.server.ts:226`), per-socket token-expiry timers (`realtime.server.ts:110`) |
| Server LISTEN channels | 3 (`new_notification`, `entity_changed` [dead], `realtime_outbox`) on 2 dedicated DB connections |
| Hook routes under `src/routes/api/public/hooks` | 11 (scheduler NOT in repo; cadence only in comments) |
| In-repo pg_cron jobs | 1 (`realtime-outbox-prune`, hourly at :17, migration 20261031000000_realtime_outbox.sql:209) |
| External endpoints the app talks to | PostgREST, Keycloak, Socket.IO (same origin), Postgres direct, date.nager.at, MS Graph, Resend, SMTP, FCM + Google OAuth. MinIO referenced in Caddyfile but no service defined |
| Other client codebases with source | 3 (browser-extension, desktop, mobile); none poll an API on a timer themselves |

---------------------------------------------------------------------------------------------------

### 1. Socket.IO connection (R-001)

| ID | Item | Evidence | Detail |
|---|---|---|---|
| R-001 | Connection | `src/integrations/realtime/socket.ts:194-200` | `io({ path:"/socket.io", autoConnect:false, reconnection:true, reconnectionDelayMax:10000, auth: cb => cb({token: localStorage.kc_token}) })`. Same origin (no URL). `transports` NOT set, so socket.io-client 4.8.4 default = HTTP long-polling first, then upgrade to WebSocket. Reconnection delay base/jitter/attempts are library defaults (1 s base, infinite attempts). |
| | Server | `src/lib/realtime.server.ts:151-157` | `new Server(httpServer,{path:"/socket.io", cors:undefined, maxHttpBufferSize:1e5, serveClient:false})`, attached to the runner.js HTTP server (`runner.js:103-117`, port 8080 in container, 7050 on host). No proxy in front. |
| | Auth handshake | `realtime.server.ts:160-182` | `io.use`: token from `handshake.auth.token` -> `verifyBackendJwt` (Keycloak JWKS, cached by jose, `jwt.server.ts:15-38`) -> `SELECT role FROM public.user_roles WHERE user_id=$1` (pg, 1 query per connect, `realtime.server.ts:124`). Failure => `unauthorized` / `unavailable`. |
| | Rooms | `realtime.server.ts:184-190`, `entity-events.server.ts:30-32` | `user:<sub>`, `authenticated` (all users), `role:manager`, `role:admin` (admin joins both role rooms). Derived from token+DB only. |
| | Reconnect policy (custom layer) | `socket.ts:180-188, 212-221, 229-236` | Extra retry for server-rejected connects: 2 s doubling to 30 s. `online` event and tab-visible reconnect immediately (`socket.ts:238-266`). |
| | Heartbeat / ping | engine.io 6.6.11 defaults (`node_modules/engine.io/build/server.js:48-49`) | pingInterval 25 000 ms, pingTimeout 20 000 ms. Not overridden anywhere in src. Payload size: Not measured. |
| | Token refresh | `socket.ts:274-285`, `realtime.server.ts:205-225` | On `TOKEN_REFRESHED` the client emits `auth:refresh` (ack, 5 s timeout); server runs verify + `SELECT user_roles` again (1 pg query). Keycloak access token lifespan is 43200 s (`infra/keycloak-realm.json`), and the 60 s timer (`src/integrations/backend/auth.ts:107-120`, `updateToken(70)`) only hits Keycloak when the token is within 70 s of expiry, so about 1 refresh + 1 auth:refresh per client per 12 h. |
| | Expiry | `realtime.server.ts:105-118` | One `setTimeout` per socket to token `exp`; emits `auth:expired` and disconnects. |
| | Socket start/stop | `use-notifications.tsx:368, 404`; `use-auth.ts:125` | `startRealtime()` only called by NotificationsProvider (mounted in `src/routes/_authenticated.tsx:108`). Its effect cleanup calls `stopRealtime()` which disconnects the shared socket for all subscribers. |

### 2. Events (every name, with emit and receive sites)

| ID | Event | Dir | Emit site | Receive site(s) | Payload | Audience / rooms | Client effect |
|---|---|---|---|---|---|---|---|
| R-002 | `resync` | C->S (ack) | `socket.ts:113` (on every connect; on tab visible after >=5 s hidden `socket.ts:254`; on `requestRealtimeResync`) | `realtime.server.ts:193-203` | `{bootId, seq}` -> ack `{bootId, seq, tables[], full}`. Server answer is computed in memory (`buildResync`, `realtime.server.ts:80-92`): no DB query. | per socket | First connect of a page load is baseline only (`socket.ts:112`); later connects/visibility call `notifyResync`: `full` => every pushed subscriber fires, else only subscribers of listed tables (`channel.ts:193-200`). A missing/late ack (5 s) => `full` refetch (`socket.ts:117-120`). |
| R-003 | `auth:refresh` | C->S (ack) | `socket.ts:278` | `realtime.server.ts:205` | token string; ack `{ok}` | per socket | On failure the client disconnects and retries. |
| R-004 | `entity:changed` | S->C | `realtime.server.ts:252` (`emitToRooms`) fed by `EntityEventBatcher` (`entity-events.server.ts:198-256`) from `outbox-listener.server.ts:401` | `channel.ts:180` (one listener per channel that has push subs) | `{schema:"public",table,eventType,new:{id,+routing ids},old:{...},bulk?}` + 2nd arg `{seq,boot}`. Ids only, no row content (`entity-events.server.ts:9-11`). Per-event size: Not measured. | per table: tasks -> assignee(new+old), reviewers, creator, **all managers**; task_review_decisions -> reviewer, decider, other reviewers, assignee, managers; task_worklogs -> logger, assignee, managers; leaves -> owner, request_to, reviewed_by, managers; eod_checkins -> owner, managers; nudges -> owner; risk_events, planning_suggestions -> managers; approval_requests -> requester, approvers, admins. TRUNCATE -> whole audience class / all users (`entity-events.server.ts:77-95`). | Dispatched to `fire()` per matching subscription with 250 ms leading+trailing throttle (`channel.ts:51, 140-156`) except notifications; hidden tab => marked dirty, one callback on visible (`channel.ts:106-113, 204-214`). |
| R-005 | `notification:new` | S->C | `notification-listener.server.ts:222` (`emitToUser`) on `LISTEN new_notification` | `channel.ts:183` (per channel), `use-notifications.tsx:371` | **Full notifications row** (`row_to_json(NEW)`, trigger `notification-listener.server.ts:139-152`): id, user_id, type, title, body, task_id, ... Size: Not measured (title/body not bounded in code). | `user:<id>` only | use-notifications: prepend row, alert, no HTTP. channel.ts: mapped to INSERT on `notifications` for MorningResume (R-011). |
| R-006 | `notification:read` | S->C | `src/services/notifications.functions.ts:23` (called at :39 per markRead, :56 per markAll) | `use-notifications.tsx:381` | `{ids[],read_at}` or `{all:true,count,read_at}` | `user:<id>` (all of that user's tabs) | Local state update, no HTTP. |
| R-007 | `automation:health` | S->C | batcher path (`entity-events.server.ts:102-106`), triggered by statement triggers on automation_runs/rules/queue_stats | `HealthPanel.tsx:22` | bulk marker `{table:"automation_health",bulk:true}` | `role:admin` | `automationsService.health()` refetch (1 request; `load` at HealthPanel.tsx:16). |
| R-008 | `auth:expired` | S->C | `realtime.server.ts:112, 222` | none (grep: no client handler) | none | one socket | Dead event; client relies on `disconnect` handler (`socket.ts:218-221`). |
| R-009 | engine.io ping/pong | both | library | library | tiny | per socket | 1 ping per 25 s per tab. |

Server-side per-event DB cost: 0 queries in the delivery path (routing is from the NOTIFY payload keys). Exception: NOTIFY payload >7000 chars degrades to `{id}` and the listener issues `SELECT ... FROM realtime.outbox WHERE id=$1` (`outbox-listener.server.ts:336-338`, `migration:50-53`).

### 3. Subscriptions: who subscribes where, and what each event triggers

Mechanics: `supabase.channel(name)` is a Proxy to `createRealtimeChannel` (`src/integrations/supabase/client.ts:89-92`). The channel name is ignored (`channel.ts:136`). There is no server-side join/subscribe message: all rooms are fixed at connect. Each `.subscribe()` that contains a push table registers 4 socket-side handlers plus a visibility flusher (`channel.ts:179-215`): `entity:changed`, `notification:new`, resync, safety refresh. Filters (`assigned_to=eq.x`, `reviewer=eq.x`, `id=in.(...)`) are evaluated in the browser against the ids in the payload (`channel.ts:125-134`); the server does not filter by client filter.

PUSH_TABLES (`channel.ts:26-37`): notifications, tasks, nudges, risk_events, planning_suggestions, approval_requests, task_review_decisions, task_worklogs, leaves, eod_checkins.

Request-cost vocabulary used below:
- SLIM(delta) = `loadAllTasksSlim` (`src/lib/task-window.ts:297-322`): first read, any read >5 min after last full read (`ALL_TASKS_FULL_RELOAD_MS`, :296), or any doubt = 1 full `tasks` GET with the page's column list; otherwise 2 parallel requests (changed rows `updated_at>=since` GET + `HEAD count`); a count mismatch (deletion) adds 1 full GET (=3).
- PEOPLE = `loadPeopleSafe`: shared 4-min cache (`src/lib/people.ts:23`), so ~0 requests per event.
- WINDOW(delta) = `refreshRecentTasks` (`task-window.ts:256-287`): 3 parallel requests (HEAD count, changed rows with embedded worklogs, worklogs since) + up to 2 more when the count mismatches.

### 3a. Always-on (shell, every authenticated page)

| ID | Subscriber (file:line) | Tables / event | Trigger -> callback | HTTP caused |
|---|---|---|---|---|
| R-010 | NotificationsProvider: `use-notifications.tsx:368-397` (mounted `_authenticated.tsx:108`) | raw socket: `notification:new` (:371), `notification:read` (:381), resync (:391), safety refresh (:397) | On login: `loadUnreadCount()` (:369) = 1 PostgREST `HEAD count notifications` (:170-175). New/read events: local state only. Resync(`full` or notifications changed): list loaded ? `load()` : `loadUnreadCount()` (:316-319). Resync on reconnect: 1 count (:393). List open: `ensureLoaded` (`NotificationsModal.tsx:99-103`), then page of notifications (LIST_LIMIT rows) + on refetch 1 index query + 1 `in(id)` for unseen ids (:220-247). | 1 per login; +1 per reconnect/resync; 1-2 per list refresh. |
| R-011 | MorningResumePromptModal `MorningResumePromptModal.tsx:142-157` (mounted `_authenticated.tsx:112`) | `notifications` INSERT (filter user_id) | `notification:new` -> if `type==="sod_digest"` -> `checkAndOpenDigestModal()` | Only on sod_digest; 0 otherwise. (Deps `[user]`, line 161: resubscribes whenever `user` identity changes; no network.) |
| R-012 | AppShell `AppShell.tsx:107` -> `use-review-decisions.ts:40` (`shell-review-decisions`) | `task_review_decisions` `*` | -> `invalidateQueries(["review-decisions"])` (`use-review-decisions.ts:58`) | 1 `listTaskReviewsFn` server-fn POST **per mounted** review query (ReviewActions.tsx:50, ReviewPanel.tsx:79, ReviewProgress.tsx:52; each keyed per task, `enabled` only when task In Review). Count depends on mounted cards: not bounded in code. staleTime 10 s (:22). |
| R-013 | AppShell `AppShell.tsx:112` -> `my-day-cache.ts:43-69` (`my-day-freshness-<uid>`) | member: tasks, task_worklogs, task_review_decisions, approval_requests (4 subs); manager: tasks(assigned_to=me), tasks(reviewer=me), task_worklogs(user_id=me), task_review_decisions(reviewer_id=me), risk_events, approval_requests (6 subs) | -> `markMyDayStale` = `invalidateQueries(..., refetchType:"none")` (:29-32) | 0 HTTP while My Day is closed; when My Day is open it only flips staleness (My Day has its own handlers, R-028/R-029). A stale flag causes ONE refetch at next My Day mount/focus. |

### 3b. Page-level

| ID | Route / component (file:line) | Hook -> channel | Tables / filter | Callback (what runs) | HTTP per fired callback (code-derived) |
|---|---|---|---|---|---|
| R-014 | /blockers `blockers.tsx:29` | `useRealtimeTasks(load,"blockers-rt")` scope all (default) | tasks, no filter | `load` (`:19-27`): PostgREST `tasks?status=eq.Blocked&select=*` (no delta) + PEOPLE | 1 (full rows every event) |
| R-015 | /calendar `calendar.tsx:159` | `useRealtimeTasks(loadTasks,"calendar-rt")`, manager/unknown = all, member = `assigned_to=eq.me` | tasks | `loadTasks` (`:115-135`): SLIM(delta) with range filter | 2 (3 on deletion; 1 full on first/5 min) |
| R-016 | /calendar `calendar.tsx:161-165` | `useRealtimeRefresh(["leaves"],..,"calendar-leaves-rt")` | leaves | `leavesService.getLeaves()` | 1 |
| R-017 | /command `command.tsx:52` | `useRealtimeTasks(load,"command-rt",all,isManager)` | tasks | `load` (`:38-49`): SLIM + PEOPLE + `risksService.listOpen()` (server fn) + `workSettingsService.get()` | 2-3 + 1 server fn + 1 settings = 4-5 per task event (settings and risks re-read on every task event) |
| R-018 | /command `command.tsx:55-60` (direct `.channel("risk-rt")`) | n/a, not gated by isManager | risk_events | `risksService.listOpen()` | 1 server fn |
| R-019 | SuggestionsPanel `SuggestionsPanel.tsx:31-35` (mounted `command.tsx:199`, `planning-suggestions.tsx:32`); subscribes even for non-managers (returns null after hooks, :38) | direct `.channel("planning-suggestions-rt")` | planning_suggestions | `planningSuggestionsService.listOpen()` | 1 (+1 initial `load()` at :30) |
| R-020 | /dashboard `dashboard.tsx:47` | direct `.channel("dash")` | tasks (all, no filter, no isManager gate) | `load` (`:27-45`): SLIM + PEOPLE + chunks of `tasks?id=in.(<=100)` for detail columns (`ceil(listIds/100)`) | 2-3 + detail chunks (>=0) |
| R-021 | /eod-tasks `eod-tasks.tsx:84` | `useRealtimeTasks(reload,"eod-tasks-rt")`, assignee=me | tasks | `reload` (`:61-76`): `taskEodService.myTasksToday()` server fn (also sets `loading=true` each time) | 1 server fn |
| R-022 | /eod `eod.tsx:132` | `useRealtimeTasks(refreshTasks,"eod-board-rt")` scope all | tasks | `refreshTasks` (`:109-130`): SLIM (single-flight + one follow-up) + in table view `loadOlderCompleted()` | 2-3 (+ older-completed read in table view; not traced) |
| R-023 | /eod `eod.tsx:134-138` | `useRealtimeRefresh(["eod_checkins"],..,"eod-checkins-rt")` | eod_checkins | `eodService.listForDate(today)` | 1 |
| R-024 | /executive `executive.tsx:303-311` | `useRealtimeRefresh(["tasks"],..,"exec-summary-rt")` | tasks | `schedule(["exec-summary"],1000)`, `schedule(["eod-widget-tasks"])`, `schedule(["exec-member-tasks"])` -> `invalidateQueries` (active only; `smart-query.ts:41-62`) | exec-summary server fn 1; eod-widget-tasks SLIM 2-3; exec-member-tasks 1 only if a member drawer is open |
| R-025 | /executive `executive.tsx:313-317` | `useRealtimeRefresh(["eod_checkins"],..)` | eod_checkins | `schedule(["exec-member-checkins"])` | 1 only if a member is selected |
| R-026 | /executive `executive.tsx:318-322` | `useRealtimeRefresh(["leaves"],..)` | leaves | `schedule(["exec-active-leaves"])` | 1 |
| R-027 | /manager `manager.tsx:28-34` | `useRealtimeRefresh(["tasks","risk_events","approval_requests"],..)` (one channel, 3 table subs, each throttled separately) | tasks, risk_events, approval_requests | `q.refetch()` directly (no debounce/scheduler), query `["manager-command"]` -> `getManagerCommand` server fn | 1 server fn per fire; up to 3 sources can each fire (leading+trailing), `refetch()` default cancels the in-flight one and restarts it |
| R-028 | /my-day `my-day.tsx:352-356` | `useRealtimeTasks(handleRealtimeChange,"my-day-<uid>")`, assignee=me | tasks | `handleRealtimeChange` (`:~330`): 250 ms debounce -> `refetchQueries(my-day-tasks)` and 800 ms debounce -> `fetchMyDay()` server fn | tasks: `refreshMyTasksWithWorklogs` (`task-window.ts:371-440`) = 2 requests (HEAD count + changed rows with worklogs), +ceil(held/100) worklog requests if no task row changed, +1 count of completed when `completedCountMayHaveChanged`, or 1 full GET; plus 1 `fetchMyDay` server fn |
| R-029 | /my-day `my-day.tsx:344-350` | `useRealtimeRefresh(["risk_events","approval_requests"],..,"my-day-extras-<uid>")` | risk_events, approval_requests | `refetchMyDay` (800 ms debounce) | 1 server fn |
| R-030 | /planning `planning.tsx:45` | `useRealtimeTasks(load,"planning-rt",all,isManager)` | tasks | `load` (`:35-43`): `tasks?select=TASK_PLANNING_COLS&status not in (Completed)` (no delta) + PEOPLE | 1 full read per event |
| R-031 | /reviews `reviews.tsx:57` | `useReviewDecisionsRealtime(load,"reviews-decisions-<scope>")` | task_review_decisions | `load` (`:34-45`): `reviewsService.queue(scope)` server fn + PEOPLE | 1 server fn |
| R-032 | /reviews `reviews.tsx:61` | `useRealtimeTasks(load,"reviews-rt-<scope>",all)` | tasks | same `load` | 1 server fn |
| R-033 | /tasks `tasks.tsx:436-440` | `useRealtimeTasks(refreshPage,"tasks-page-rt")`, manager/canSeeAll = all, member = assignee=me | tasks | `refreshPage` (`:398-430`): signature read (`id,updated_at` + count, `task-list-query.ts:175`) 1 + `fetchTasksByIds(changed)` 0-1; then after 1200 ms `countsTick` re-runs the counters (`tasks.tsx:~357-385`) | member: +1 (4-column read of own tasks, `task-list-query.ts:254`); manager: sidebar 6 status + 3 priority HEAD counts + tab counts 3 + header counts 3 = up to 15 HEAD requests (identical URLs in the same moment are de-duplicated, `task-list-query.ts:~205-216`); so 2-17 per event, plus a fallback full page read if the signature path throws |
| R-034 | /team-capacity `team-capacity.tsx:320` | `useRealtimeRefresh(["tasks","task_worklogs"],..,"capacity-tasks-rt")` | tasks, task_worklogs | `schedule(["capacity-tasks"])` (300 ms debounce); prefix match also covers `["capacity-tasks","older-count"]` | WINDOW(delta) 3 + 1 HEAD count = 4 |
| R-035 | /team-capacity `team-capacity.tsx:321` | `useRealtimeRefresh(["leaves"],..)` | leaves | `schedule(["capacity-active-leaves"])` | 1 |
| R-036 | /workload `workload.tsx:32` | `useRealtimeTasks(load,"workload-rt")` scope all | tasks | `load` (`:22-31`): SLIM + PEOPLE | 2-3 |
| R-037 | HealthPanel `automation/HealthPanel.tsx:22-26` (configure.automations.tsx:24, configure.tsx:64 health tab; admin) | raw socket `automation:health`, resync (only if `automation_health` changed or full), safety refresh | automation_health | `automationsService.health()` | 1 |
| R-038 | NudgeCenter `NudgeCenter.tsx:22` | direct `.channel("nudges-<uid>")` | nudges (user_id=me) | `nudgesService.listActive` | **DEAD**: component is never mounted (grep `NudgeCenter` finds only its own file) |

Pages without any realtime: time-tracking, admin, intelligence, heatmap, settings.operations, notebook and others (grep of `useRealtime*`, `.channel(`, `onRealtime` shows none). `time-tracking` still re-reads on focus (finding F-04).

### 4. Client recovery / safety traffic (not event-driven)

| ID | Mechanism | Evidence | Trigger | Frequency | Effect |
|---|---|---|---|---|---|
| R-039 | Resync after reconnect | `socket.ts:202-208` | each connect after the first | per reconnect | targeted (tables changed) or `full` => every subscriber of every mounted page refetches once |
| R-040 | Visibility resync | `socket.ts:241-255`, `channel.ts:84-113` | tab visible after >=5 s hidden | per return | resync + dirty flushes; `RECENT_FIRE_MS` 2 s suppresses double fire (`channel.ts:76, 197`) |
| R-041 | Shared safety refresh while disconnected | `socket.ts:43, 68-88` | socket down | 60 s, 120 s, 240 s, then every 300 s; skipped when tab hidden (:79); stops on connect | fires ALL pushed subscribers of all channels (`channel.ts:202`) and notifications/health handlers |
| R-042 | Server restart / outbox gap | `realtime.server.ts:83-85` (bootId mismatch => `full`), `outbox-listener.server.ts:278-282, 373-379` (`emitResyncAll`) | every deploy/restart; outbox pruned past cursor | rare | every connected client refetches everything it shows at the same moment (thundering herd). Bound: sum over mounted subscribers per client. |
| R-043 | Offline-queue drain | `use-online-sync.ts:31-42`, `offline-queue.ts:49, 106-143` | mount, `online`, window `focus` | per event; max 6 attempts per op, delay `min(2000*attempt, 8000)` ms between ops | 1 PostgREST write per queued op (tasks insert/update, comments insert, generic insert; `offline-queue.ts:159-179`); 0 HTTP when queue empty |

### 5. Page-wise map (route -> realtime subscriptions -> HTTP refetches)

Shell on every authenticated route adds: R-010 (1 count at login), R-011, R-012 (fan-out to mounted review cards), R-013 (0 HTTP). Manager sockets receive EVERY task / worklog / leave / checkin / risk / suggestion event org-wide (rooms: `role:manager`), members only their own.

| Route | Subscriptions (IDs) | Event -> HTTP |
|---|---|---|
| /my-day | R-028, R-029 (+R-013 staleness) | task event -> 2-3 task requests (250 ms) + 1 fetchMyDay (800 ms); risk/approval -> 1 fetchMyDay |
| /tasks | R-033 | task event -> 2-3 requests now + (member 1 / manager up to 15 HEAD) after 1.2 s |
| /calendar | R-015, R-016 | task -> 2-3; leave -> 1 |
| /eod | R-022, R-023 | task -> 2-3 (+older completed in table view); checkin -> 1 |
| /eod-tasks | R-021 | task (mine) -> 1 server fn |
| /dashboard | R-020 | task -> 2-3 + detail chunks |
| /command | R-017, R-018, R-019 | task -> 4-5; risk -> 1; suggestion -> 1 |
| /planning | R-030 | task -> 1 full read |
| /planning-suggestions | R-019 | suggestion -> 1 |
| /workload | R-036 | task -> 2-3 |
| /blockers | R-014 | task -> 1 full read |
| /reviews | R-031, R-032 | decision -> 1 server fn; task -> 1 server fn (two independent channels) |
| /executive | R-024, R-025, R-026 | task -> summary 1 + window 2-3 (+member 1); checkin -> 0-1; leave -> 1 |
| /manager | R-027 | any of tasks/risk/approvals -> 1 server fn (undebounced, up to 3 sources) |
| /team-capacity | R-034, R-035 | task or worklog -> 4; leave -> 1 |
| /configure (health tab) | R-037 | automation_health -> 1 |
| /time-tracking, /admin, /intelligence, /heatmap, /settings.operations, /notebook | none | none (time-tracking: see F-04) |

---------------------------------------------------------------------------------------------------

### 6. Server-side background work (B-xxx)

Startup wiring: `src/server.ts:11-19` starts cron ticker (unless read-only), notification listener, outbox listener; `server.ts:24-25` exposes `attachRealtime` for runner.js.

| ID | Item | file:line | Trigger / interval | Tables touched | Queries per tick (code-derived) | Notes |
|---|---|---|---|---|---|---|
| B-001 | Cron ticker loop | `cron-ticker.server.ts:46, 381` | `setInterval` 60 000 ms, every process (no leader election; dedupe is in-memory `__cronFiredKeys` :17-25) | leaves, work_settings, holidays | Weekday/public-holiday tick: (1) `promoteDueTentativeLeaves(today)` unthrottled -> `UPDATE public.leaves ... WHERE status='tentative' AND start_date<=$1` (pg) (`leaves.server.ts:92-97`; `ensureLeavesTableAdmin` DDL runs once, :6-37); (2) `checkIsWorkingDayServer`: PostgREST `work_settings?select=workdays&id=eq.1` (`workday-checker.server.ts:26-30`) + pg `SELECT ... FROM public.holidays` (:50-52); (3) PostgREST `work_settings?select=morning_digest_time,evening_digest_time` (`cron-ticker.server.ts:69-73`) = 4 statements (2 PostgREST + 2 pg). Weekend per `workdays`: 2 (1 pg + 1 PostgREST). Company holiday: 3. | Per day, 1440 ticks: weekday 5 760 statements (2 880 PostgREST + 2 880 pg); weekend 2 880; company holiday 4 320. Settings read every tick although they change rarely. |
| B-002 | Morning step | `cron-ticker.server.ts:86-107` | tick where IST time == `morning_digest_time` (once per day per process) | notifications, leaves, user_roles, tasks | HTTP `POST ${APP_URL}/api/public/hooks/morning-digest?force=true` (self-call, header only `x-cron-secret`), `dispatchAdvanceLeaveAlerts` (:387-467: 1 + 1 + 1 pg, then per leave x per manager: 1 SELECT + 1 INSERT), `pushOverdueTasks` (`task-push.server.ts:149-`: up to 10 working-day lookups, 1 tasks query, `getUsersOnLeaveTodayServer`, FCM sends if configured) | Exact per-day count depends on data. |
| B-003 | Evening step | `cron-ticker.server.ts:112-146` | tick == `evening_digest_time` | profiles, notifications, leaves | 1 profiles + leave query, then per active profile 1 SELECT dedupe + 1 INSERT (sequential, `supabaseAdmin`); then `dispatchAdvanceLeaveAlerts("evening")` | 2N PostgREST calls for N active users. |
| B-004 | Manager EOD report | `cron-ticker.server.ts:152-377` | tick == evening time + 15 min | notifications, profiles, **tasks (all columns listed, no filter)**, notification_prefs | 1 dedupe SELECT + 3 parallel reads (full tasks table read) + 1 INSERT + email send | Reads the whole `tasks` table once/day. |
| B-005 | Notification LISTEN | `notification-listener.server.ts:110-182, 155` | LISTEN `new_notification` on a pool client held forever (`pool.connect`, :117); reconnect after 5 s on error/end (:90-96); no heartbeat | notifications (trigger installed with `CREATE OR REPLACE`/`DROP TRIGGER` DDL on every (re)connect, :139-152, unless read-only) | 0 per idle; DDL batch per (re)connect | Holds 1 of max 10 pool connections permanently. |
| B-006 | Per-notification processing | `notification-listener.server.ts:217-448` | each NOTIFY | profiles, notification_prefs, tasks | Socket emit (0 DB). If push configured: 1 prefs query (:191) + FCM POST(s). `task_assigned`: batched 2 s per user (:237-240); else immediate. `processSingle...`: 2 queries (profile, prefs) + up to 1 tasks query (digest/general) + 1 email (Graph/Resend/SMTP). 15 s in-memory dedupe (:56-74). | ~3-4 DB queries + 1 outbound email per notification. |
| B-007 | `LISTEN entity_changed` | `notification-listener.server.ts:159-168`, batcher :36-41 | LISTEN | none | 0 | **Dead**: no `notify_entity_changed` trigger exists in `supabase/` or `infra/` (grep). A second `EntityEventBatcher` instance exists here, separate from the outbox one (`outbox-listener.server.ts:389`): if a legacy trigger were present the same change would be emitted twice. |
| B-008 | Outbox LISTEN + heartbeat | `outbox-listener.server.ts:171-199, 223-240` | own `pg.Client`, `LISTEN realtime_outbox`; heartbeat `SELECT 1` every 30 000 ms (timeout 5 s); backoff 1 s..30 s on loss | realtime.outbox, pg_trigger | Heartbeat: 2 880 `SELECT 1`/day. Connect/reconnect: `SELECT max(id)` + prune `DELETE ... created_at < now()-24h` (first connect, :253-258) or replay `SELECT ... WHERE id > cursor-1000` + 1 info query (:264-267); `verifyTriggers` 1 query (:299). | Per change: no polling. |
| B-009 | Outbox write amplification (DB triggers) | `supabase/migrations/20261031000000_realtime_outbox.sql:58-136` | every INSERT/UPDATE/DELETE on 9 tables (row trigger) + statement triggers on 3 automation tables | tasks, nudges, risk_events, planning_suggestions, approval_requests, task_review_decisions, task_worklogs, leaves, eod_checkins, realtime.outbox | Per changed task row: `to_jsonb(NEW/OLD)` compare + 1 `task_reviewers` aggregate + 1 INSERT into realtime.outbox + 1 `pg_notify`; worklogs/decisions add 1 `tasks` lookup; approval_requests add a multi-join. No-op updates are skipped (:75-77). | Bulk updates on tasks = one outbox row + NOTIFY per row (the app batcher collapses >100 rows/table/100 ms window into one bulk signal, `entity-events.server.ts:245-248`). |
| B-010 | Outbox prune | migration:207-216; `outbox-listener.server.ts:256` | pg_cron `17 * * * *` (24 per day) and once per process start | realtime.outbox | 1 DELETE | Only runs if pg_cron extension present (compose preloads it, `infra/docker-compose.yml:16`). |
| B-011 | Entity batcher | `entity-events.server.ts:198-256` | 100 ms window, bulk threshold 100 per table | none | 0 DB | Coalesces same row; per window emits to union of rooms. |
| B-012 | Socket server timers | `realtime.server.ts:105-118` | 1 timeout per connected socket | none | 0 | + 1 pg query per connect and per `auth:refresh` (B-008 above is separate). |
| B-013 | requireCronAuth (every hook call) | `cron-auth.server.ts:49-80` | each hook invocation (except `morning-digest?force=true`) | cron_invocations | 3 PostgREST: HEAD count (rate limit), INSERT (nonce), DELETE (>24 h GC, fires on every call, not periodically). Rate window 30 s per route (:25). | See F-11. |
| B-014 | automation-tick | `routes/api/public/hooks/automation-tick.ts:13`, `lib/automation/worker.server.ts:55-107` | external scheduler, documented "every 30 seconds" (comment, :7). **No scheduler in repo.** | automation_events, approval_outbox_events, automation_rules, automation_runs, automation_action_log, tasks, notifications, org_roles ... | Idle tick: 3 (auth) + RPC lock + SELECT approval_outbox_events (limit 200) + SELECT automation_events (limit 100 = BATCH_SIZE :15) + RPC unlock = 7 PostgREST. Add 2 per outbox row; 1 UPDATE per claim; per event >=1 rules query + per rule ~4 (counts, run insert/update, action log) | If scheduled as documented: 2 880 invocations/day, 20 160 PostgREST requests/day idle. |
| B-015 | automation-due-enqueue | `hooks/automation-due-enqueue.ts:7-12` | doc: every 15 min (due.reached), daily 02:00 UTC (due.missed) | tasks, automation_events | 3 auth + 2 `select ... from tasks` + 1 `enqueue_automation_event` RPC per due task (no pagination limit seen) | Scheduler not in repo. |
| B-016 | morning-digest | `hooks/morning-digest.ts:19-` | doc: daily ~08:30; also self-called by B-002 | profiles, tasks (all), notification_prefs, work_settings, notifications | reads 4, then per user INSERT(s) | `force=true` skips cron auth (:23-26). |
| B-017 | evening-digest | `hooks/evening-digest.ts:24-` | doc: daily ~18:30 | profiles, tasks (all), notification_prefs, work_settings, notifications | 4 reads + per user INSERT + team email | |
| B-018 | no-tasks-reminder | `hooks/no-tasks-reminder.ts:9, 16-` | doc: every 20 min (`no_tasks_reminder_interval`, default 20, :76) | profiles, tasks (all), notification_prefs, work_settings, notifications | 5 reads incl. full tasks table + inserts | 72 invocations/day if scheduled as documented, each reads full tasks. |
| B-019 | carry-forward | `hooks/carry-forward.ts:7` | doc: daily ~02:00 | tasks | 1 read + RPC per overdue task | |
| B-020 | detect-risks | `hooks/detect-risks.ts:15` | doc: daily ~07:00; also browser button (`services/risks.ts:33`) | via RPC `detect_risks` | 1 RPC | |
| B-021 | generate-nudges | `hooks/generate-nudges.ts:12` | no cadence in comment; browser button (`services/nudges.ts:18`) | RPC `generate_nudges` | 1 RPC | |
| B-022 | planning-suggestions | `hooks/planning-suggestions.ts:12` | no cadence; browser (`services/planning-suggestions.ts:24`) | RPC | 1 RPC | |
| B-023 | workload-snapshot | `hooks/workload-snapshot.ts:19-20, 73` | doc: daily | tasks (`select *`, all rows), profiles, daily_workload_snapshot | 2 reads + upserts | |
| B-024 | adoption-rollup | `hooks/adoption-rollup.ts:15` | no cadence | RPC | 1 RPC | |
| B-025 | Outbound mail | `services/email-dispatcher.ts:26-93, 263` | per email | n/a | MS Graph token POST + sendMail POST, or Resend POST, or SMTP | |
| B-026 | Push (FCM) | `lib/fcm.server.ts:74, 131`; `task-push.server.ts:65, 102, 149` | per assigned/progress/overdue push | device_tokens | Google OAuth token POST + 1 FCM POST per device token | No-op unless `FCM_SERVICE_ACCOUNT_JSON` set. |
| B-027 | JWT verification | `jwt.server.ts:15-38` | each server fn / socket connect | n/a | JWKS cached in process by jose | No per-request Keycloak call after the first fetch. |

Task-timer (`task-timer.server.ts`): no timers, only helper functions (`bankTimer`, `pauseOtherRunningTimers`) called from task server fns; no background loop.
Task action routes (`routes/api/public/actions/*`): user-triggered (push buttons / email links), not background.

---------------------------------------------------------------------------------------------------

### 7. Infra and external endpoints

| ID | Endpoint | Where defined | Evidence | Notes |
|---|---|---|---|---|
| I-001 | PostgREST v12.2.0 at `http://{API_DOMAIN}` -> `postgrest:3000`, `uri strip_prefix /rest/v1` | `infra/Caddyfile:1-5`, `infra/docker-compose.yml:31-44` | Browser `VITE_SUPABASE_URL` points here (compose build arg `:81`, local `http://localhost:7051`) | `encode zstd gzip` added in uncommitted working-tree change (`git diff infra/Caddyfile`); LAN Caddyfile already has it (`infra/lan/Caddyfile.lan:29`); `Caddyfile.local` does not. PostgREST also reached server-side by `supabaseAdmin` via SUPABASE_URL (compose env `:88`). PostgREST JWT secret (JWKS + an HS256 "service_role_key" entry) is committed in compose (`:41`). |
| I-002 | Keycloak 24.0.5 at `http://{AUTH_DOMAIN}` -> `keycloak:8080` (realm `lovable`, client `execution-os`) | `Caddyfile:7-9`, compose `:46-73`, `auth.ts:23-24` | `start-dev` mode in compose (`:49`) | Server verifies tokens via internal `KEYCLOAK_INTERNAL_URL` JWKS (`jwt.server.ts:22-25`). |
| I-003 | Files `http://{FILES_DOMAIN}` -> `minio:9000` | `Caddyfile:11-13` | No `minio` service in any compose file (grep) | Dangling. Attachments are stored in Postgres (`bytea`) via `/app-storage/upload` and `/app-storage/file` (`src/routes/app-storage/upload.ts:7-14`, `integrations/backend/storage.ts:35`). |
| I-004 | Socket.IO `/socket.io` | on the app origin, `runner.js:103-117` | App container published 7050->8080 directly (`compose:84-85`); NOT behind Caddy | No proxy timeouts/upgrade config involved. Static files, SSR and compression are done by runner.js itself (`runner.js:32-60`, `Cache-Control` immutable for `/assets/`). |
| I-005 | Postgres 5432 (published 7055) with pg_cron preloaded | `compose:4-29` | LISTEN connections: 2 dedicated (B-005, B-008) + pool max 10 | Hook routes are not scheduled by any in-repo pg_cron job. |
| I-006 | Vite/dev proxies | `vite.config.ts` | none (only `server.entry`, line 13) | |
| I-007 | Dockerfile entrypoint | `Dockerfile:42` | `CMD ["node","runner.js"]`, PORT 8080 | |
| I-008 | date.nager.at | `src/lib/format.ts:287` | `fetch("https://date.nager.at/api/v3/publicholidays/<year>/IN")` from the browser (calendar.tsx:168, HolidayBanner.tsx:84, TaskFormDialog.tsx:307); in-flight de-dupe + localStorage miss TTL (`format.ts:275-285`) | Third-party call from every client. |
| I-009 | MS Graph / Resend / SMTP / FCM+Google OAuth | see B-025, B-026 | server only | |
| I-010 | GitHub workflows | `.github/workflows/{ci,android-build,desktop-build}.yml` | no cron/schedule or curl to the app found | Not a source of API traffic. |

---------------------------------------------------------------------------------------------------

### 8. Other clients (X-xxx)

| ID | Client | file:line | Endpoint | Trigger / interval | Notes |
|---|---|---|---|---|---|
| X-001 | Browser extension "operon-quick-notes" | `browser-extension/operon-quick-notes/background.js:8-31` | none of its own; opens a popup window to `${operonUrl}/notebook?quicknotes=1` (default `http://localhost:8080`) | on user action | No `fetch`, no alarms/timers (grep). The popup is the normal web app, so it makes the full web-app traffic (REST, socket). options.js only validates and stores the URL. |
| X-002 | Desktop (Electron) | `desktop/main.js:164, 212` | `loadURL(BASE_URL())` (default `http://operon.noesisanalytics.co.in`, `:13`) and `${BASE_URL()}/notebook?quicknotes=1` | on start / quick-notes window | No `fetch`, no `setInterval`/`setTimeout` for API calls (grep). A second window = a second full web-app session (own socket). |
| X-003 | Mobile (Capacitor Android) WebView | `mobile/capacitor.config.json` (`server.url https://operon.noesisanalytics.co.in`) | same origin as web app | continuous | Full web-app traffic incl. socket. App resume calls `refreshSessionNow` (`use-native-app.ts:35-37`) = local `updateToken(70)` check. |
| X-004 | Mobile native push action | `mobile/android/app/src/main/java/in/co/noesisanalytics/operon/NotificationActionReceiver.java:37-60` | `POST /api/public/actions/push-start-task` (8 s timeouts) | user taps "Start" on a notification | One request per tap; no polling. |
| X-005 | Device token registration | `src/hooks/use-native-app.ts:29` | `registerDeviceTokenFn` server fn | FCM token event, per login in native app | 1 request. |
| X-006 | Web: browser-called hook routes | `services/risks.ts:33`, `services/nudges.ts:18`, `services/planning-suggestions.ts:24` | `POST /api/public/hooks/{detect-risks,generate-nudges,planning-suggestions}` | UI buttons | They send no `x-cron-*` headers while these routes call `requireCronAuth` (hook files line 3 imports it), so the code path yields 401. Unverified at runtime. |
| X-007 | Web: Notebook autosave | `src/components/notebook/notesStore.ts:12, 54-67` | server fn `pushNote` | debounce 700 ms after each edit; `flushNotes` on demand | per edit burst. |
| X-008 | Web: Keycloak token timer | `auth.ts:107-120` | Keycloak token endpoint only when token within 70 s of expiry | `setInterval` 60 s (never cleared) | See R-001 (about 1 per 12 h). |

---------------------------------------------------------------------------------------------------

### 9. Retry / refetch policy that multiplies traffic (item 5)

| Item | Evidence | Effect |
|---|---|---|
| QueryClient defaults | `src/router.tsx:7-9`: only `retry: shouldRetryQuery`. staleTime stays 0 and `refetchOnWindowFocus`/`refetchOnReconnect`/`refetchOnMount` stay library default (true). | Every `useQuery` without an override refetches on focus and mount. Overrides exist only in my-day (staleTime 2 min, focus true, `my-day.tsx:302-304`), people (`refetchOnWindowFocus:false`), manager (30 s, focus false), executive/team-capacity (`realtimeCovered`/`slowChanging`, `smart-query.ts:28-32`), review decisions (10 s), time-tracking (10 s / 30 s). Only 22 `useQuery` call sites exist in src (6 files); everything else is manual `useEffect` + service calls. |
| Retry | `src/lib/query-retry.ts:9-15` | Max 2 retries (3 attempts) for transient errors only; no retry for 4xx except 408/429 and "permanent" message patterns. Applies to React Query only (not to manual loads). |
| Cache-Control on every PostgREST request | `src/integrations/supabase/client.ts:36-55` | Sends `Cache-Control: no-cache, no-store, must-revalidate`, `Pragma: no-cache`, `Expires: 0` on every call, disabling browser/proxy caching for all REST reads. |
| Offline queue | `offline-queue.ts:49, 136`; `use-online-sync.ts:31-42` | See R-043. |
| Smart refresh scheduler | `smart-query.ts:41-62` | Debounces (300 ms default) and invalidates only active queries; used in executive and team-capacity only. Not used by manager, reviews, blockers, planning, workload, dashboard, command, calendar, eod. |
| Channel throttle | `channel.ts:51, 140-156` | 250 ms leading + trailing per subscription. Worst case 2 callback runs per burst per subscription. Not applied to `notifications`. |
| Socket.IO reconnection | `socket.ts:194-200` | Library defaults + custom retry 2 s..30 s; safety refresh 60 s..5 min while down (R-041). |

---------------------------------------------------------------------------------------------------

### 10. Findings (evidence)

F-01 Manager page refetch storm: `manager.tsx:28-34` subscribes to 3 tables in one channel and calls `q.refetch()` directly. Each table subscription is throttled separately (`channel.ts:140-156`), so one user action that touches tasks + risk_events + approval_requests can run `getManagerCommand` up to 6 times (3 sources x leading+trailing), each cancelling/restarting the previous fetch while the server still executes. Executive/Capacity/My Day debounce this (`smart-query.ts`, `my-day.tsx:318-330`); Manager does not.

F-02 Reviews page double load and shell fan-out: `reviews.tsx:57` and `:61` register two channels that run the same `load` (server fn `listReviewQueueFn` + people). A review submission typically emits both a task and a task_review_decisions event. In addition `AppShell.tsx:107` invalidates all `["review-decisions"]` queries on every decision event (`use-review-decisions.ts:58`): one `listTaskReviewsFn` call per mounted ReviewActions/ReviewPanel/ReviewProgress instance (count not bounded in code), and AppShell mounts this on every page for every user who receives the event (reviewers, decider, assignee, managers).

F-03 Per-event refetch cost is high for manager sockets because the server sends every task event to every manager (`entity-events.server.ts:124-127`, `MANAGERS_ROOM`). Pages that re-read on every task event for a manager: command (4-5 requests, includes `risksService.listOpen` and `workSettingsService.get` that cannot change on a task event, `command.tsx:38-49`), dashboard (2-3 + detail chunks, no isManager gate, `dashboard.tsx:27-47`), eod (2-3), workload (2-3), calendar (2-3), tasks (2 + up to 15 HEAD counts after 1.2 s, `tasks.tsx:398-430` and counters), team-capacity (4), executive (3-5), manager (1 server fn). A manager with several of these open in separate tabs pays each independently (each tab has its own socket).

F-04 Full (non-delta) reads on every event or focus: `blockers.tsx:19-27` (select * of Blocked tasks every task event, scope all), `planning.tsx:35-43` (all non-completed tasks, planning columns, every task event), `time-tracking.tsx:88-118` (no realtime; reads ALL tasks (TASK_TIMESHEET_COLS) and ALL task_worklogs on mount and on every window focus after 10 s staleTime because focus refetch is default-on, `router.tsx:8`). Only calendar/command/dashboard/eod/workload/my-day/capacity/executive use delta reads.

F-05 Duplicate/overlapping subscriptions: (a) one page can hold 2-3 channels for related tables (my-day R-028+R-029 plus shell R-013; reviews R-031+R-032 plus shell R-012; command R-017+R-018+R-019: a `risk_events` change triggers only R-018 but a task event also re-reads risks inside R-017); (b) `useMyDayFreshness` re-subscribes tasks/worklogs/decisions that other hooks on the same page also hear (0 HTTP, JS cost only); (c) every channel registers its own `entity:changed` and `notification:new` socket listeners plus resync and safety handlers (`channel.ts:179-215`), so the number of JS handlers per event equals the number of mounted channels (shell 3 + page 1-3); (d) channel names are ignored (`channel.ts:136`), so "unique name" bookkeeping provides no de-duplication.

F-06 Thundering herd on resync `full`: restart/deploy changes the boot id, so every client answers `full` (`realtime.server.ts:83-85`, `socket.ts:122-127`), firing every subscriber of every mounted page at once on every connected client. Same for outbox gap (`outbox-listener.server.ts:373-379`). Safety refresh (R-041) repeats this every 5 minutes per client while the socket is down, only when the tab is visible.

F-07 Dead code with live cost or risk: NudgeCenter subscription (unmounted, R-038); `LISTEN entity_changed` + second batcher (B-007) with no trigger in repo; `auth:expired` has no listener (R-008); `emitToRole` unused (`realtime.server.ts:256`, no callers); SuggestionsPanel subscribes and fetches for non-managers before returning null (`SuggestionsPanel.tsx:29-38`).

F-08 Cron ticker does work every minute that rarely changes: `cron-ticker.server.ts:52` runs an unthrottled `UPDATE leaves` each tick (throttle exists only for `getUsersOnLeaveTodayServer`, `workday-checker.server.ts:93`) and reads `work_settings` twice and `holidays` once per tick (B-001): 5 760 statements per working day for a decision that changes at most daily. Each replica would run its own ticker (no leader lock).

F-09 Cron hooks: scheduler not found in repo (only comments give cadence: automation-tick 30 s, due-enqueue 15 min, no-tasks-reminder 20 min). If scheduled as documented, automation-tick alone is about 20 160 PostgREST requests/day idle (B-014), no-tasks-reminder reads the entire tasks table 72 times/day (B-018), and `requireCronAuth` adds 3 PostgREST calls per invocation including a `DELETE` GC on every call (B-013).

F-10 Rate limit equals cadence: `cron-auth.server.ts:25` blocks a second call to the same route within 30 s; automation-tick is documented every 30 s (`automation-tick.ts:7`), so alternating 429s are possible (inference from the code, depends on scheduler jitter).

F-11 Self-call bypass: `cron-ticker.server.ts:93-97` calls `morning-digest?force=true` with only `x-cron-secret`; `morning-digest.ts:23-26` skips `requireCronAuth` entirely when `force=true`, so any caller of this public route can trigger the digest. Browser buttons for detect-risks/generate-nudges/planning-suggestions send no cron headers (X-006) and would receive 401.

F-12 Always-on server cost per connected client: 1 `SELECT user_roles` per connect and per `auth:refresh` (`realtime.server.ts:124`), 1 engine.io ping/25 s. Transport defaults to polling-then-upgrade (`socket.ts:194-200`), so each connect begins with HTTP polling requests before the WebSocket upgrade.

F-13 Notification pipeline write amplification: each notification costs 1 outbox-independent NOTIFY, a full-row socket payload (R-005), 2-4 DB queries and 1 email in `notification-listener.server.ts:217-448`; the trigger DDL (`CREATE OR REPLACE` + `DROP/CREATE TRIGGER`) is re-run on every listener reconnect (:139-152), taking a lock on `public.notifications` each time.

F-14 Realtime outbox adds 1 INSERT + 1 NOTIFY per changed row on 9 tables (B-009); bulk task updates (carry-forward, auto-pause on leave `leaves.server.ts:42-70`, one UPDATE per task in a loop) produce one outbox row per task, collapsed by the server batcher into one bulk signal only above 100 rows per table per 100 ms (`entity-events.server.ts:245-248`).

F-15 Infra dangling/commit hygiene: Caddyfile routes FILES_DOMAIN to `minio:9000` with no minio service (I-003); app port 7050 is outside Caddy so API compression applies only to PostgREST (`encode zstd gzip` is an uncommitted change); compose commits PostgREST JWT key material (`docker-compose.yml:41`).

---------------------------------------------------------------------------------------------------

### 11. Not measured / limits of this audit

- No traffic captured: all request counts are code-derived upper/typical bounds; payload sizes "Not measured" except where code bounds them (NOTIFY 7000 chars `migration:50-53`, socket inbound `maxHttpBufferSize` 1e5, LIST_LIMIT rows for notifications).
- External scheduler (pg_cron jobs / Task Scheduler / curl) for `api/public/hooks/*` was not found in the repository; cadences are from comments only.
- `task-list-query` counter dedupe (`head` in-flight map) was read at `task-list-query.ts:205-216` but exact URL equality between sidebar/tab/header requests was not enumerated, so 15 is the maximum.
- Server functions (`getManagerCommand`, `fetchMyDay`, `listReviewQueueFn`, `listTaskReviewsFn`, `fetchSummary`) were counted as 1 HTTP request each; their internal SQL query counts belong to another part of the audit.

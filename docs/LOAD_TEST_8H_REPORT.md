# 8-Hour Load Test Report — 10 Concurrent Users

> Generated 2026-11-02T12:14:15.712Z from `scripts/loadtest/out/run8h`. Scripts: `scripts/loadtest/`.

## Verdict: PASS — the stack handled 10 concurrent users for the full window

| Check | Result | Detail |
|---|---|---|
| All 10 users stayed active the whole window | PASS | 10/10 sessions finished; ran 0.5 h of 0.5 h |
| API error rate < 1% (4xx/5xx/network, aborted excluded) | PASS | 0.000% of 1,481 API requests |
| No 5xx and no network failures | PASS | 0 5xx, 0 network failures |
| API P95 < 1000 ms and P99 < 2000 ms | PASS | P95 158 ms, P99 239 ms |
| No container restarted / OOM | PASS | app-1|Up 32 minutes; postgrest-1|Up 32 minutes; keycloak-1|Up 33 minutes (healthy); caddy-1|Up 33 minutes; postgres-1|Up 33 minutes (healthy) |
| Memory stable (no container grew > 25% first→last quarter, none above 80% of its limit) | PASS | app 0.8%, postgrest 3.1%, keycloak 0.1%, caddy 1%, postgres 10%; peak 4.8% of limit |
| Postgres: no deadlocks, no ungranted locks at sampling | PASS | 0 deadlocks, max waiting locks 0 |

## Test setup

- Window: 2026-10-31T10:38:53.347Z → 2026-10-31T11:10:50.588Z (0.5 h)
- Users: 5 managers (`ltmgr1-5`) + 5 members (`ltmem1-5`), each a real Edge browser session (Playwright), logged in via Keycloak and kept active. Staggered start (0–20 s).
- Behaviour per user: loop of {navigate to a role-appropriate page via the sidebar, scroll, read 15–75 s}, 10% chance of a full page reload per loop. Managers rotate over command, dashboard, planning, eod-tasks, team-capacity, workload, reviews, tasks, executive, time-tracking, notifications, manager, calendar. Members rotate over my-day, today, tasks, calendar, notifications, eod, leaves, notebook.
- Background: 15 simulated "other-user" changes (task status flips + notifications inserted straight into the DB every 60–180 s) to exercise realtime fan-out.
- Target: local Docker stack `dailyflow-local` (app, caddy, postgrest, keycloak, postgres 5 containers) on one Windows host; Docker VM limit 7.9 GB RAM.
- Sampling: `docker stats` + Postgres `pg_stat_*` every 10 s (194 samples).

## 1. Requests and traffic

Totals: **17,747 HTTP requests** over 0.5 h (9.3 req/s average). Client-side bytes (headers + body, on the wire): **9.3 MB sent, 29.5 MB received**.

- Inbound HTTP (client → stack, i.e. what Caddy/app/Keycloak received): **17,737** requests.
- Total API requests (PostgREST): **2,101** (1,481 completed, 620 cancelled by the browser mid-flight).
- Outbound HTTP to third parties: **10** browser-side calls (e.g. public-holiday lookup); the app container has email/FCM disabled in this stack, so no server-side third-party calls were made. Server-internal hops (app → caddy → postgrest, app → keycloak) are not separately logged by these services; see "Limitations".
- WebSocket (Socket.IO): 167 connections opened, 1,064 frames received, 1,015 sent, 99.8 KB payload.

### By traffic type
| Type | Requests | Aborted | Sent | Received |
|---|---|---|---|---|
| app | 14,583 | 26 | 4.7 MB | 6.6 MB |
| api | 2,101 | 620 | 3.6 MB | 22.1 MB |
| socketio-poll | 859 | 0 | 787.2 KB | 196.5 KB |
| auth | 194 | 0 | 285.8 KB | 598.9 KB |
| other | 10 | 10 | 0 KB | 0 KB |

### Per user
| User | Role | Requests | API | App | Auth | Sent | Received | Avg API latency | Failed |
|---|---|---|---|---|---|---|---|---|---|
| ltmem1 | member | 1,351 | 73 | 1,175 | 16 | 607.3 KB | 932.4 KB | 50.5 ms | 0 |
| ltmem2 | member | 1,613 | 86 | 1,412 | 19 | 690.6 KB | 1.1 MB | 44.7 ms | 0 |
| ltmem3 | member | 2,269 | 121 | 1,979 | 26 | 959.9 KB | 1.1 MB | 40.5 ms | 0 |
| ltmem4 | member | 1,630 | 87 | 1,423 | 19 | 683 KB | 968.1 KB | 44.7 ms | 0 |
| ltmem5 | member | 1,341 | 67 | 1,180 | 15 | 563.4 KB | 919 KB | 41.5 ms | 0 |
| ltmgr1 | manager | 1,686 | 182 | 1,281 | 17 | 987.4 KB | 3.6 MB | 51.7 ms | 0 |
| ltmgr2 | manager | 2,018 | 214 | 1,568 | 23 | 1.2 MB | 5.4 MB | 53.6 ms | 0 |
| ltmgr3 | manager | 2,080 | 196 | 1,699 | 21 | 1.3 MB | 4.5 MB | 44.8 ms | 0 |
| ltmgr4 | manager | 1,709 | 203 | 1,305 | 17 | 1.1 MB | 5.1 MB | 55.6 ms | 0 |
| ltmgr5 | manager | 2,050 | 252 | 1,561 | 21 | 1.3 MB | 6 MB | 60.2 ms | 0 |

Per-role: managers 9,543 requests (1,533 API), members 8,204 requests (568 API).

## 2. Response time (ms, completed requests only)
| Group | Count | Avg | P50 | P95 | P99 | Max |
|---|---|---|---|---|---|---|
| API (PostgREST) — all | 1,481 | 50.8 | 38 | 158 | 239 | 476 |
| API — GET/HEAD reads | 1,471 | 50.9 | 38 | 158 | 239 | 476 |
| App server (pages + assets) | 14,557 | 56.3 | 41 | 157 | 231 | 329 |
| Auth (Keycloak token refresh) | 194 | 33.5 | 23 | 84 | 153 | 253 |
| Socket.IO polling | 859 | 39 | 28 | 100 | 147 | 273 |
| All HTTP (non-aborted) | 17,091 | 54.7 | 40 | 153 | 231 | 476 |

### Busiest API endpoints
| Endpoint | Count | Avg | P50 | P95 | P99 | Max |
|---|---|---|---|---|---|---|
| GET tasks | 673 | 56.5 | 38 | 170 | 256 | 476 |
| GET profiles | 429 | 61.9 | 52 | 145 | 239 | 253 |
| GET user_roles | 280 | 18.3 | 10 | 53 | 122 | 190 |
| GET projects | 29 | 50.5 | 37 | 130 | 153 | 153 |
| GET teams | 29 | 58.5 | 48 | 142 | 153 | 153 |
| GET profile_emails | 17 | 66.7 | 56 | 201 | 201 | 201 |
| GET notifications | 11 | 60.8 | 45 | 231 | 231 | 231 |
| POST rpc/ensure_user_profile | 10 | 38.3 | 21 | 130 | 130 | 130 |
| GET task_worklogs | 3 | 56 | 54 | 82 | 82 | 82 |

### Slowest 5 requests
| When | User | Request | Status | ms |
|---|---|---|---|---|
| 16:09:05 (+0h) | ltmgr4 | GET /rest/v1/tasks | 200 | 476 |
| 16:08:56 (+0h) | ltmgr2 | GET /rest/v1/tasks | 200 | 448 |
| 16:15:25 (+0.1h) | ltmem5 | GET /today | 200 | 329 |
| 16:39:09 (+0.5h) | ltmem2 | GET /_serverFn/06191a7c1b9bd1619ba198ebaf85263fb7f2ca1eee6724f4738cf1e23f2caa3f | 200 | 327 |
| 16:39:09 (+0.5h) | ltmem2 | GET /_serverFn/bf8777ef1a4c7b610346310964c523923149ef97594424e9e93b850fba2f185b | 200 | 317 |

## 3. Errors

- Failed (4xx/5xx/network, aborted excluded): **0** of 17,091 completed requests (0.000%).
- 5xx: 0 · 4xx: 0 · network failures: 0
- Browser-cancelled (`net::ERR_ABORTED`, e.g. a count query abandoned when the user navigated away; not a server failure): 656
- Page JS errors: 0 · navigation errors: 86 of 299 navigations.

## 4. Docker resource usage (docker stats, 10 s samples)
| Container | Avg CPU | P95 CPU | Peak CPU | Avg RAM MB | Peak RAM MB | RAM first→last quarter | Net RX | Net TX | Disk read | Disk write |
|---|---|---|---|---|---|---|---|---|---|---|
| app | 1.4% | 7.5% | 40.1% | 90.5 | 91.5 | 90.1 → 90.8 | 9.1 MB | 15.6 MB | 100 KB | 0 KB |
| caddy | 0.5% | 2.3% | 13.8% | 20.1 | 21.8 | 20.1 → 20.3 | 35.9 MB | 36.4 MB | 176 KB | 0 KB |
| keycloak | 2.4% | 3.5% | 275.2% | 382.7 | 387.6 | 382.4 → 382.7 | 367 KB | 680 KB | 100 KB | 2 MB |
| postgres | 5% | 16.1% | 249.2% | 127.1 | 141.8 | 120.8 → 132.9 | 15.1 MB | 38.6 MB | 1 MB | 12.6 MB |
| postgrest | 0.8% | 3.5% | 32.5% | 64.1 | 66.2 | 62.8 → 64.7 | 45.3 MB | 39 MB | 0 KB | 0 KB |

- Whole stack: avg 10.1% CPU (of 1 core = 100%), **peak 323.4% at 16:11:42 (+0h)**; avg 684.5 MB RAM, **peak 701.9 MB at 16:30:33 (+0.4h)**.
- Container network counters are per-container and include container-to-container hops, so adding them double-counts. Edge view: caddy RX 35.9 MB / TX 36.4 MB; app RX 9.1 MB / TX 15.6 MB.

## 5. Database (PostgreSQL `dailyflow_test`)

| Metric | Value |
|---|---|
| Connections avg / peak (this DB) | 23.5 / 27 |
| Active queries peak | 3 |
| Transactions committed during test | 5,265 (2.7/s) |
| Rollbacks | 24 |
| Rows returned / fetched | 7,451,524 / 324,250 |
| Rows inserted / updated / deleted | 82 / 75 / 11 |
| Buffer cache hit ratio | 99.99% |
| Temp bytes written | 0 KB |
| Deadlocks / max waiting locks | 0 / 0 |
| Database size start → end | 132.1 MB → 132.2 MB |

Postgres container CPU/RAM/disk I/O are in the Docker table above (`postgres` row).

## 6. Peaks

- Peak request rate: **1,113 req/min** at 16:29:00 (+0.3h); **265 req in one second** at 16:08:56 (+0h).
- Peak API rate: 232 API req/min at 16:11:00 (+0h).
- Highest stack CPU: 323.4% at 16:11:42 (+0h) · highest stack RAM: 701.9 MB at 16:30:33 (+0.4h) · highest single-container RAM use: 4.8% of its limit.

## 7. Hour by hour
| Hour | Requests | API req | API avg ms | API P95 | API P99 | Failed | Stack CPU avg | Stack CPU peak | Stack RAM avg |
|---|---|---|---|---|---|---|---|---|---|
| H1 | 17,747 | 2,101 | 50.8 | 158 | 239 | 0 | 8.7% | 323.4% | 684.6 MB |

## Limitations (read before quoting these numbers)

- Request counts, sizes and latencies are measured **in the browser** (what a user's device sees, including Caddy/app time but on loopback, so network latency is ~0). A real WAN/VPN will add RTT to every figure.
- "Outbound" server-to-server HTTP (app → Caddy → PostgREST, app → Keycloak) is not logged by these services. They are visible only as container network counters. Caddy has no access log enabled and was not reconfigured for this test.
- Runs on a single Windows host with the dev-mode Keycloak (`start-dev`) and a production-data copy of Postgres. Production hardware and `start` mode will differ.
- Client-side REST writes are denied on this local stack: RLS policies such as `tasks_insert` call `auth.uid()`, which returns NULL here because PostgREST's legacy `request.jwt.claim.sub` GUC is not populated (`req_uid()` has a fallback; `auth.uid()` does not). The workload is therefore read-heavy plus DB-side simulated activity, not user-driven writes. Worth checking whether production behaves the same.
- Think times (15–75 s per page) model an attentive user; heavier users (rapid filter/search, bulk edits) would generate more API traffic than shown.

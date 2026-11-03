# Network Traffic Report: Load Test `run2`

- **Date:** 2 Nov 2026, 17:22–17:43
- **Duration:** 21.3 min
- **Users:** 10 (5 managers: ltmgr1–5, 5 members: ltmem1–5)
- **Data source:** `scripts/loadtest/out/run2/requests.jsonl`
- **Result:** all 10 sessions completed, no failures

## Totals

| Metric | Value |
|---|---|
| Requests | 11,864 |
| Downloaded | 17.82 MB |
| Uploaded | 5.65 MB |
| HTTP 200 | 11,535 |
| HTTP 204 | 10 |
| HTTP 4xx/5xx | 0 |
| Status 0 (not ok) | 319 (likely cancelled by navigation) |

## By type

| Type | Requests | Downloaded | p50 | p95 |
|---|---|---|---|---|
| app (pages, JS, CSS, server functions) | 10,015 | 5.87 MB | 36 ms | 194 ms |
| api (REST) | 1,130 | 11.44 MB | 34 ms | 153 ms |
| socket.io polling | 575 | 0.13 MB | 23 ms | 98 ms |
| auth (token) | 134 | 0.39 MB | 22 ms | 111 ms |
| other | 10 | 0.00 MB | 569 ms | 1100 ms |

## By role

| Role | Requests | Downloaded |
|---|---|---|
| Manager | 5,774 | 13.51 MB |
| Member | 6,090 | 4.32 MB |

## By user

| User | Requests | Downloaded | Req/min |
|---|---|---|---|
| ltmgr1 | 1,451 | 3.57 MB | 72.5 |
| ltmgr2 | 1,155 | 2.71 MB | 57.8 |
| ltmgr3 | 1,001 | 2.09 MB | 50.0 |
| ltmgr4 | 877 | 2.04 MB | 43.9 |
| ltmgr5 | 1,290 | 3.09 MB | 64.5 |
| ltmem1 | 321 | 0.73 MB | 16.1 |
| ltmem2 | 841 | 0.81 MB | 42.0 |
| ltmem3 | 1,946 | 0.95 MB | 97.3 |
| ltmem4 | 1,313 | 0.88 MB | 65.7 |
| ltmem5 | 1,669 | 0.93 MB | 83.5 |

## Top endpoints by count (excluding static assets)

| Count | Downloaded | p95 | Endpoint |
|---|---|---|---|
| 363 | 10.92 MB | 153 ms | GET /rest/v1/tasks |
| 357 | 0.09 MB | 102 ms | GET /socket.io/ |
| 315 | 0.01 MB | 54 ms | GET /icon.svg |
| 221 | 0.39 MB | 102 ms | GET /rest/v1/profiles |
| 218 | 0.04 MB | 61 ms | POST /socket.io/ |
| 195 | 0.00 MB | 276 ms | HEAD /rest/v1/tasks |
| 177 | 0.10 MB | 51 ms | GET /rest/v1/user_roles |
| 134 | 0.39 MB | 111 ms | POST /realms/lovable/protocol/openid-connect/token |
| 112 | 0.00 MB | 94 ms | HEAD /rest/v1/notifications |

## Top endpoints by bytes

| Downloaded | Count | Endpoint |
|---|---|---|
| 10.92 MB | 363 | GET /rest/v1/tasks |
| 2.82 MB | 134 | GET /assets/index-*.js |
| 0.84 MB | 65 | GET /assets/TaskCard-*.js |
| 0.54 MB | 58 | GET /assets/BarChart-*.js |
| 0.39 MB | 134 | POST token endpoint |
| 0.39 MB | 221 | GET /rest/v1/profiles |

## WebSocket

Each user sent and received about 50–75 frames, under 0.4 KB per user.

## Findings

1. **Tasks query dominates traffic.** `GET /rest/v1/tasks` is 61% of all downloaded bytes (about 30 KB per call).
2. **Bundle re-downloaded each login.** `index-*.js` was fetched 134 times (2.82 MB), matching 134 token calls. Each session used a fresh browser context, so there was no cache reuse. Real users would hit the cache.
3. **Uneven member activity.** `ltmem3` made about 97 req/min and `ltmem1` about 16, probably due to the pages each simulated user visited.
4. **Slowest common call.** `HEAD /rest/v1/tasks` (count queries) has p95 of 276 ms.
5. **Latency is healthy.** All main types are under 200 ms at p95.

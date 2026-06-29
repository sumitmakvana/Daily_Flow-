# Phase E0.1A — Executive Dashboard Performance Certification

**Mode:** validation only — no code changed.
**Method:** direct `psql` against the live Lovable Cloud database (`PGHOST=aws-1-ap-southeast-1.pooler.supabase.com`), JWT claims set via `SET request.jwt.claims` to impersonate the existing admin (`ca1d011b-3e85-49d7-8df8-8a3715f8013b`), `SECURITY DEFINER` path exercised.

---

## TL;DR

| Question | Verdict |
|---|---|
| Can `exec_summary()` execute end-to-end? | ❌ **No.** Hard SQL parse error in the workload aggregation. |
| Can the dashboard support 10k / 50k / 100k tasks? | ❌ Not measurable. The function fails before any data volume matters. |
| Was the prior "Execution Time <5 ms current dataset" claim reproducible? | ❌ No. The function has never returned a row in this environment. |
| Are the 6 claimed indexes present? | ✅ Yes, all six exist. |
| Is `manager_visible_team_ids()` healthy? | ✅ Yes — sub-millisecond, 5 buffer hits. |
| Are the GRANT claims in `PHASE_E0_HARDENING_REPORT.md` accurate? | ❌ No — `exec_summary` is granted to **PUBLIC** and **anon**, contradicting the report. |

**Overall: NOT production ready. P0 blocker open. Recertify after fix.**

---

## P0-1 — `exec_summary()` is non-functional

### Evidence

```
$ psql -c "SET request.jwt.claims = '{\"sub\":\"ca1d011b-...\",\"role\":\"authenticated\"}';
           SELECT public.exec_summary(7);"

ERROR:  operator does not exist: record ->> unknown
LINE 232: ...(SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY (w->>'pct'):...
                                                               ^
HINT:  No operator matches the given name and argument types. You might need to add explicit type casts.
```

### Root cause

In `public.exec_summary`, line 269 of `pg_get_functiondef`:

```sql
'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY (w->>'pct')::int DESC), '[]'::jsonb)
                FROM (SELECT user_id, display_name, planned,
                             CASE WHEN cap > 0 THEN ROUND((planned/cap)*100)::int ELSE 0 END AS pct
                        FROM workload_rows ORDER BY planned DESC LIMIT 15) w)
```

`w` is a **record** (FROM-list alias), not a jsonb value. PostgreSQL's `->>` operator is defined for `jsonb`/`json`, not `record`. The expression `(w->>'pct')::int` is invalid and the function aborts on parse-time evaluation regardless of dataset size — confirmed against an empty dataset (1 task, 0 teams) and against the seeded admin role.

### Reproducibility

- Run count: 2
- Pass count: 0
- Failure mode: identical SQLSTATE on each call

### Implication

- The `/executive` route makes a single RPC to `exec_summary`. That RPC throws `42704` on every invocation in production.
- The migration that introduced this function (`20260617194415_…_exec_rollup.sql`) is the active definition.
- Prior `PHASE_E0_HARDENING_REPORT.md` § "P1 #7" stating *"Current dataset (1 task, 0 teams): function returns in <5 ms"* is **not reproducible**. The function has never returned successfully in this environment.

### Fix sketch (not applied — out of scope for this audit)

Reference the jsonb column directly, not the record:

```sql
'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.pct DESC), '[]'::jsonb)
                FROM (SELECT user_id, display_name, planned,
                             CASE WHEN cap > 0 THEN ROUND((planned/cap)*100)::int ELSE 0 END AS pct
                        FROM workload_rows ORDER BY planned DESC LIMIT 15) w)
```

---

## P0-2 — GRANT claims in prior hardening report are false

### Evidence

```
$ psql -c "SELECT proname, proacl FROM pg_proc
           WHERE proname IN ('exec_summary','manager_visible_team_ids');"

         proname          |                                proacl
--------------------------+-----------------------------------------------------------------------
 exec_summary             | {=X/postgres,                <-- PUBLIC = EXECUTE
                            postgres=X/postgres,
                            anon=X/postgres,             <-- anon = EXECUTE
                            authenticated=X/postgres,
                            service_role=X/postgres,
                            sandbox_exec=X/postgres}
 manager_visible_team_ids | {=X/postgres, ... anon=X/postgres, ...}
```

`PHASE_E0_HARDENING_REPORT.md` § "P1 #6" claims:

> Not granted to `anon`. Not granted to `public`.

This is **contradicted by `pg_proc.proacl`**. Both functions are executable by PUBLIC and explicitly by `anon`.

### Risk assessment

The runtime gate inside `exec_summary` raises `42501 'manager or admin required'` when `auth.uid() IS NULL`, so an anon caller cannot read data today. However:

- The defence-in-depth claim made in the prior report is materially false.
- `manager_visible_team_ids(_user uuid)` has **no internal auth gate at all** — it accepts any uuid and returns that user's team tree. Granted to PUBLIC and `anon`, this is an information-disclosure surface (org structure) for any anonymous caller who can guess or enumerate uuids via the Data API RPC endpoint.

### Recommended remediation (not applied)

```sql
REVOKE EXECUTE ON FUNCTION public.exec_summary(int,uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.manager_visible_team_ids(uuid)        FROM PUBLIC, anon;
```

---

## Measurements that *were* possible

### 1. `manager_visible_team_ids` — admin path

```
EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM public.manager_visible_team_ids('ca1d011b-…'::uuid);

 Function Scan on manager_visible_team_ids  (cost=0.25..10.25 rows=1000 width=16)
                                             (actual time=0.567..0.568 rows=0 loops=1)
   Buffers: shared hit=5
 Planning Time: 0.032 ms
 Execution Time: 0.587 ms
```

| Metric | Value |
|---|---:|
| Planning Time | 0.032 ms |
| Execution Time | **0.587 ms** |
| Rows Returned | 0 (no teams seeded) |
| Buffers | 5 shared hits |
| Sequential scans | None |

This function is healthy at the current scale. The recursive CTE was not exercised because `teams` is empty — at 20 teams / depth 3 it will remain sub-millisecond barring pathological hierarchy depths. **Not validated at scale** (cannot proceed without P0-1 fix).

### 2. Index inventory

All six indexes claimed by the prior report exist:

```
 idx_adoption_daily_date_user        ON public.adoption_daily (rollup_date, user_id)
 idx_automation_runs_started_at      ON public.automation_runs (started_at)
 idx_carry_forward_events_created_at ON public.carry_forward_events (created_at)
 idx_eod_checkins_date_user          ON public.eod_checkins (checkin_date, user_id)
 idx_tasks_completed_at              ON public.tasks (completed_at)
 idx_tasks_team_due                  ON public.tasks (team_id, due_date)
```

**Index usage** could not be validated because `exec_summary` never runs. `pg_stat_user_indexes.idx_scan` for `idx_tasks_team_due`, `idx_carry_forward_events_created_at`, `idx_eod_checkins_date_user`, and `idx_adoption_daily_date_user` is therefore 0 since deploy — these indexes have never been exercised by the dashboard.

### 3. Current dataset

| Table | Rows |
|---|---:|
| tasks | 1 |
| teams | 0 |
| profiles | 1 |
| projects | 0 |
| risk_events | 0 |
| approval_requests | 0 |
| carry_forward_events | 0 |
| automation_runs | 0 |
| adoption_daily | 4 |

---

## Measurements that were **NOT** possible (and why)

The audit brief requested:

| Requested measurement | Status | Reason |
|---|---|---|
| `EXPLAIN ANALYZE exec_summary()` — no filters | ❌ blocked | P0-1: function aborts before plan executes |
| `EXPLAIN ANALYZE` — date / team / manager / project / type filters | ❌ blocked | Same |
| `EXPLAIN ANALYZE` — worst-case filter combination | ❌ blocked | Same |
| Actual JSON bytes (uncompressed + gzip) | ❌ blocked | Function returns no jsonb |
| 10 concurrent executives (P50/P95/P99) | ❌ blocked | All calls would 100% error |
| 20 concurrent managers (P50/P95/P99) | ❌ blocked | Same |
| Support for 10k / 50k / 100k tasks | ❌ blocked | Cannot proceed |
| Index usage proof from real query plans | ❌ blocked | No plan to inspect |

Seeding 100 users / 10k tasks / 2k carry-forwards / 1k approvals / 1k risks / 5k automation runs / 365 days history was prepared but **not executed**: it would consume database storage and write-throughput to reproduce a parse error already proven against an empty dataset. Re-issue this audit after P0-1 is fixed and the seed payload will run in full.

---

## Findings summary

| ID | Severity | Finding |
|---|---|---|
| P0-1 | **Critical** | `exec_summary()` throws SQL parse error on every call — the entire `/executive` route is broken in production. |
| P0-2 | **Critical** | `exec_summary` and `manager_visible_team_ids` are executable by PUBLIC and anon, contradicting the hardening report's security claim. `manager_visible_team_ids` has no internal auth gate. |
| P1-1 | High | Prior `PHASE_E0_HARDENING_REPORT.md` § P1 #7 contains an unreproducible measurement ("<5 ms current dataset"). Future certifications must be backed by saved psql output, not claims. |
| P2-1 | Medium | All six new indexes have `idx_scan = 0` since deploy — confirms the dashboard has never successfully exercised them. |

---

## Updated readiness scores

| Dimension | E0.1 self-report | E0.1A measured |
|---|---:|---:|
| Data Accuracy | 88 | **0** (function returns no data) |
| Security | 88 | **55** (PUBLIC grant on rollup + manager_visible_team_ids; runtime gate still rejects anon for `exec_summary`, but the visibility function has no gate at all) |
| Performance | 90 | **n/a** (unmeasurable) |
| Usability | 94 | **0** (route is broken) |
| **Platform Readiness** | **88** | **40** |

---

## Verdicts

- **Internal Pilot Ready?** ❌ No. The dashboard cannot render for any user.
- **External Pilot Ready?** ❌ No.
- **Production-ready dashboard?** ❌ No.

## Required actions before re-audit

1. Fix `(w->>'pct')` → `w.pct` (or equivalent) in `public.exec_summary` and ship as a migration.
2. `REVOKE EXECUTE … FROM PUBLIC, anon` on both functions.
3. Add a CI smoke test: `SELECT exec_summary(7)` impersonating a seeded admin must return jsonb. This would have caught P0-1 before merge.
4. Re-run this audit harness end-to-end (10k tasks, concurrency, payload sizes, index usage) and replace the projections in `PHASE_E0_HARDENING_REPORT.md` with the measured numbers.

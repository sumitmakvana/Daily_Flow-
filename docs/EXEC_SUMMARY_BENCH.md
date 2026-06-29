# Executive Dashboard Benchmark Procedure

Canonical performance test for `public.exec_summary`. Phase E0.1D onward,
**every certification run MUST exercise 10 k, 50 k, and 100 k task corpora**
and the regression test in `tests/integration/exec-summary-perf.test.ts`
must stay green.

## Stages & budgets

| Stage | Tasks | `exec_summary` SLA (server-side `EXPLAIN ANALYZE Execution Time`) |
|---|---:|---:|
| 10k  | 10 000 | **300 ms** |
| 50k  | 50 000 | **1 000 ms** |
| 100k | 100 000 | **1 000 ms** |

Side-table volumes seeded proportionally:
- `risk_events` / `approval_requests` = tasks / 10
- `carry_forward_events` = tasks / 5
- `automation_runs` = tasks / 2
- `adoption_daily` = 100 users × 60 days (static)

## Variants measured at every stage

1. `no_filters` — admin home view, 7-day window. **Dominant case.**
2. `date_30` — 30-day window, no other filters.
3. `team=<one team>` — drill-down (should be < 300 ms at every stage).
4. `project=<one project>` — drill-down.
5. `manager=<admin>` — manager-scoped.
6. `type=<task>` — work-item-type filter.
7. `worst` — 90-day window + type filter.

For each variant: 1 `EXPLAIN (ANALYZE, BUFFERS)` (capture plan, exec time,
shared hits, temp blocks) + 5 warm-cache timed runs via `psql \timing`.

## Running the benchmark

```bash
# 1. Seed (idempotent, incremental)
bash scripts/seed-loadtest.sh 100000    # or 10000 / 50000

# 2. Measure
bash scripts/bench-exec-summary.sh > artifacts/bench-$(date +%s).log

# 3. Regression test in CI
EXEC_SUMMARY_TEST_UID=<admin-uuid> bunx vitest run tests/integration/exec-summary-perf.test.ts
```

The vitest regression auto-detects stage from current `tasks` count and
applies the matching budget. CI must run it against a 100k-seeded snapshot
before publishing for external pilot.

## Seed caveats (sandbox)

- `profiles.id` has FK to `auth.users`, so seed-from-psql uses a single admin
  profile. Production benchmarks should seed via the admin API and spread
  `assigned_to` across ≥ 100 users for accurate workload bucketing.
- `automation_rules.trigger_kind` is constrained; reuse an existing rule
  ID instead of inserting a synthetic rule.
- The pooler does not grant `ANALYZE` privilege — rely on autovacuum or
  trigger a manual stats refresh from the admin role outside the pooler.

## Reading the results

A row in the bench output looks like:

```
no_filters   plan_exec=1019.703 ms  shared hit=3340   temp read=0 written=0   warm=[1130 1547 1407 1321 1391]
```

- `plan_exec` — server-side execution time from `EXPLAIN ANALYZE`. Compare against the SLA.
- `shared hit` — pages read from cache. ≥ 200 000 indicates a full heap scan of `tasks` (expected on unfiltered).
- `temp read/written` — sort/hash spill. **Must be 0** post-E0.1D (function pinned to `work_mem=32MB`).
- `warm` — `psql \timing` includes ~150 ms round-trip and JSON serialisation in this sandbox.

/**
 * Phase E0.1D regression test: exec_summary latency budget.
 *
 * This test enforces per-stage SLAs documented in
 * docs/EXEC_SUMMARY_BENCH.md. It will FAIL CI if the function regresses
 * beyond the budget at the dataset size present in the connected DB.
 *
 * Stage detection is automatic from `tasks` row count:
 *   <= 15 000  → 10k budget    (300 ms)
 *   <= 60 000  → 50k budget   (1 000 ms)
 *   otherwise  → 100k budget  (1 000 ms)  // E0.1D ceiling
 *
 * Pre-reqs:
 *   - PG* env vars point at a project DB seeded via scripts/seed-loadtest.sh
 *   - Test user has admin or manager role
 *
 * Skipped automatically when PG env vars are missing or dataset is empty
 * (so it never blocks plain unit-test runs).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const ADMIN = process.env.EXEC_SUMMARY_TEST_UID;
const hasPg = !!process.env.PGHOST;

const describeIf = hasPg && ADMIN ? describe : describe.skip;

describeIf('exec_summary perf budget (E0.1D)', () => {
  const client = new Client();
  let budgetMs = 0;
  let stageLabel = '';

  beforeAll(async () => {
    await client.connect();
    await client.query(`SET request.jwt.claims = '${JSON.stringify({ sub: ADMIN, role: 'authenticated' })}'`);
    const { rows } = await client.query<{ count: string }>('SELECT count(*)::text FROM tasks');
    const n = Number(rows[0].count);
    if (n <= 15_000) { budgetMs = 300; stageLabel = '10k'; }
    else if (n <= 60_000) { budgetMs = 1000; stageLabel = '50k'; }
    else { budgetMs = 1000; stageLabel = '100k'; }
    // eslint-disable-next-line no-console
    console.log(`[bench] tasks=${n} → stage=${stageLabel} budget=${budgetMs}ms`);
  });

  afterAll(async () => { await client.end(); });

  async function timeIt(args: string): Promise<number> {
    // discard cold run, time 3 warm runs, return median
    await client.query(`SELECT length(public.exec_summary(${args})::text)`);
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      await client.query(`SELECT length(public.exec_summary(${args})::text)`);
      samples.push(performance.now() - t0);
    }
    return samples.sort((a, b) => a - b)[1];
  }

  it('unfiltered home view stays within budget', async () => {
    const ms = await timeIt('7, NULL, NULL, NULL, NULL');
    // eslint-disable-next-line no-console
    console.log(`[bench:${stageLabel}] no_filters median=${ms.toFixed(0)}ms (budget ${budgetMs}ms)`);
    expect(ms).toBeLessThan(budgetMs);
  });

  it('team-filtered drill-down stays well within budget', async () => {
    // team filter should be much faster — give it 1/3 of the budget
    const ms = await timeIt(
      `7, (SELECT id FROM teams ORDER BY id LIMIT 1)::uuid, NULL, NULL, NULL`,
    );
    // eslint-disable-next-line no-console
    console.log(`[bench:${stageLabel}] team median=${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(Math.max(300, budgetMs / 3));
  });

  it('worst-case (90d + type filter) stays within budget', async () => {
    const ms = await timeIt(
      `90, NULL, NULL, (SELECT id FROM work_item_types WHERE name='Task' LIMIT 1)::uuid, NULL`,
    );
    // eslint-disable-next-line no-console
    console.log(`[bench:${stageLabel}] worst median=${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(budgetMs);
  });
});

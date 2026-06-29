/**
 * Load test harness — seeds N users, work items, attachments, and workflows,
 * then runs a small read benchmark. Requires PG* env vars (psql access).
 *
 * Usage:
 *   bun tests/load/harness.ts           # default profile (100 / 10k / 1k / 50)
 *   USERS=50 ITEMS=5000 bun tests/load/harness.ts
 *   PURGE=1 bun tests/load/harness.ts   # drop seeded rows before re-seeding
 *
 * Honest scope: this drives raw SQL through psql to validate index behavior
 * and write throughput. It does NOT exercise auth, RLS, Realtime fan-out, or
 * the Vite dev server — those need a separate Playwright/k6 run.
 */
import { execSync } from "node:child_process";

const USERS = Number(process.env.USERS ?? 100);
const ITEMS = Number(process.env.ITEMS ?? 10_000);
const ATTACHMENTS = Number(process.env.ATTACHMENTS ?? 1_000);
const WORKFLOWS = Number(process.env.WORKFLOWS ?? 50);
const RULES = Number(process.env.RULES ?? 500);
const TAG = "loadtest";
const TAG = "loadtest";

function sql(q: string): string {
  return execSync(`psql -t -A -F $'\\t' -c ${JSON.stringify(q)}`, { encoding: "utf8" }).trim();
}
function time<T>(label: string, fn: () => T): T {
  const t0 = Date.now();
  const r = fn();
  console.log(`  ${label.padEnd(38)} ${Date.now() - t0} ms`);
  return r;
}

if (!process.env.PGHOST) {
  console.error("PG* env vars missing — cannot run load harness.");
  process.exit(1);
}

console.log(`Load profile: ${USERS} users • ${ITEMS} items • ${ATTACHMENTS} attachments • ${WORKFLOWS} workflows`);

if (process.env.PURGE === "1") {
  console.log("\n[purge] removing prior load-test rows…");
  sql(`DELETE FROM public.attachments WHERE file_name LIKE '${TAG}-%'`);
  sql(`DELETE FROM public.tasks WHERE task_name LIKE '${TAG}-%'`);
  sql(`DELETE FROM public.work_item_transitions WHERE label LIKE '${TAG}-%'`);
  sql(`DELETE FROM public.profiles WHERE display_name LIKE '${TAG}-%'`);
}

console.log("\n[seed]");
time("profiles", () => sql(`
  INSERT INTO public.profiles (id, display_name, email, is_active)
  SELECT gen_random_uuid(), '${TAG}-user-' || g, '${TAG}-' || g || '@example.com', true
    FROM generate_series(1, ${USERS}) g
  ON CONFLICT DO NOTHING;
`));

time("work items", () => sql(`
  WITH u AS (SELECT id FROM public.profiles WHERE display_name LIKE '${TAG}-%' ORDER BY display_name),
       t AS (SELECT id FROM public.work_item_types ORDER BY sort_order LIMIT 1)
  INSERT INTO public.tasks (task_name, status, priority, assigned_to, type_id, due_date, planned_hours)
  SELECT '${TAG}-item-' || g,
         (ARRAY['To Do','In Progress','Blocked','In Review','Completed'])[1 + (g % 5)]::task_status,
         (ARRAY['Low','Medium','High'])[1 + (g % 3)]::task_priority,
         (SELECT id FROM u OFFSET (g % ${USERS}) LIMIT 1),
         (SELECT id FROM t),
         CURRENT_DATE + ((g % 30) - 10),
         (g % 6) + 1
    FROM generate_series(1, ${ITEMS}) g;
`));

time("attachments", () => sql(`
  WITH wi AS (SELECT id FROM public.tasks WHERE task_name LIKE '${TAG}-%' ORDER BY random() LIMIT ${ATTACHMENTS}),
       u  AS (SELECT id FROM public.profiles WHERE display_name LIKE '${TAG}-%' LIMIT 1)
  INSERT INTO public.attachments (work_item_id, file_name, file_size, file_type, storage_path, uploaded_by)
  SELECT wi.id, '${TAG}-file-' || wi.id || '.pdf', 12345, 'application/pdf',
         wi.id || '/${TAG}.pdf', (SELECT id FROM u)
    FROM wi;
`));

time("workflows (transitions)", () => sql(`
  WITH t AS (SELECT id FROM public.work_item_types ORDER BY sort_order LIMIT 1),
       s AS (SELECT id FROM public.work_item_statuses WHERE type_id = (SELECT id FROM t) ORDER BY sort_order)
  INSERT INTO public.work_item_transitions (type_id, from_status_id, to_status_id, label, sort_order)
  SELECT (SELECT id FROM t),
         (SELECT id FROM s OFFSET (g % GREATEST(1,(SELECT count(*)::int FROM s) - 1)) LIMIT 1),
         (SELECT id FROM s OFFSET ((g+1) % GREATEST(1,(SELECT count(*)::int FROM s))) LIMIT 1),
         '${TAG}-flow-' || g, g
    FROM generate_series(1, ${WORKFLOWS}) g
  ON CONFLICT DO NOTHING;
`));

console.log("\n[read benchmarks]");
time("today: assignee+status+due_date", () => sql(`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT id FROM public.tasks
   WHERE assigned_to = (SELECT id FROM public.profiles WHERE display_name LIKE '${TAG}-%' LIMIT 1)
     AND status <> 'Completed' AND due_date <= CURRENT_DATE + 1;
`));
time("planning: open + due_date scan", () => sql(`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT count(*) FROM public.tasks WHERE status <> 'Completed' AND due_date < CURRENT_DATE + 7;
`));
time("workload: per-user planned_hours", () => sql(`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT assigned_to, sum(planned_hours) FROM public.tasks
   WHERE status <> 'Completed' GROUP BY assigned_to;
`));
time("risk: predict_tomorrow_risks()", () => sql(`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT count(*) FROM public.predict_tomorrow_risks();
`));
time("notifications feed", () => sql(`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT id FROM public.notifications
   WHERE user_id = (SELECT id FROM public.profiles LIMIT 1)
   ORDER BY created_at DESC LIMIT 50;
`));

console.log("\nDone. Re-run with PURGE=1 to clean up.");

/* -------------------------- automation track --------------------------- */
// Phase D hardening: seed N inert rules, fire one batch of events, measure
// queue depth and worker-tick throughput.

console.log("\n[automation seed]");
if (process.env.PURGE === "1") {
  sql(`DELETE FROM public.automation_runs WHERE rule_id IN (SELECT id FROM public.automation_rules WHERE name LIKE '${TAG}-%')`);
  sql(`DELETE FROM public.automation_events WHERE event_kind = '${TAG}.synthetic'`);
  sql(`DELETE FROM public.automation_rules WHERE name LIKE '${TAG}-%'`);
}

time(`automation_rules (${RULES})`, () => sql(`
  INSERT INTO public.automation_rules
    (name, trigger_kind, condition_expr, actions, is_active, dedupe_window_minutes, max_runs_per_minute, allow_self_retrigger)
  SELECT
    '${TAG}-rule-' || g,
    '${TAG}.synthetic',
    '{}'::jsonb,
    '[{"kind":"notify_user","params":{"user_id":"00000000-0000-0000-0000-000000000000","title":"noop"}}]'::jsonb,
    false,                       -- inert: avoids real notification fan-out
    60,
    60,
    false
  FROM generate_series(1, ${RULES}) g
  ON CONFLICT DO NOTHING;
`));

console.log("\n[automation read benchmarks]");
time("active-rule lookup by trigger", () => sql(`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT id FROM public.automation_rules
   WHERE trigger_kind = '${TAG}.synthetic' AND is_active = true AND auto_disabled_at IS NULL;
`));
time("pending-event drain scan", () => sql(`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT id FROM public.automation_events
   WHERE processed_at IS NULL AND dropped = false AND available_at <= now()
   ORDER BY available_at LIMIT 100;
`));
time("runs feed (last 24h)", () => sql(`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT id FROM public.automation_runs
   WHERE started_at > now() - interval '24 hours'
   ORDER BY started_at DESC LIMIT 100;
`));
time("queue depth (stats counter)", () => sql(`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT pending_count FROM public.automation_queue_stats WHERE id = 1;
`));
time("dead-run lookup for replay", () => sql(`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT id FROM public.automation_runs WHERE status = 'dead' ORDER BY started_at DESC LIMIT 50;
`));

console.log("\nAutomation harness done. Re-run with PURGE=1 to remove seeded rules.");

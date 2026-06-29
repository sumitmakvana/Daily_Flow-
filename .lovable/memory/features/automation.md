---
name: Automation engine
description: Trigger-driven automation rules: tables, worker, save-time guards, cron. Reference when changing automation behavior.
type: feature
---
Phase D engine. Strictly additive; do not modify existing trigger bodies.

Tables: `automation_rules`, `automation_events` (outbox/queue), `automation_runs` (audit+DLQ), `automation_action_log`, `approval_outbox_events` (decoupled from `on_approval_decision`), `automation_queue_stats` (counter).

Triggers enqueue via SECURITY DEFINER `enqueue_automation_event` — applies backpressure (soft 5k / hard 50k drops low-priority kinds) and depth ceiling (5) via session GUC `app.automation_depth`.

Worker: `src/lib/automation/worker.server.ts`, invoked by `/api/public/hooks/automation-tick` (every minute). Drains approval outbox first, then claims ≤100 events. Uses `automation_try_lock`/`automation_unlock` (bigint key `0x6c_76_61_75_74_6f`) for single-tick concurrency. Per-event txn, retries with exponential backoff, dead after 3 attempts.

Save-time validators in `src/lib/automation/validators.ts` enforce: self-retrigger guard (M1), notify dedupe ≥60min (M9/M10), at most 20 actions, action params via Zod (`src/lib/automation/actions.ts`).

Circuit breaker: rule auto-disables when >80% of last 20 runs failed; admin re-enables via Rules tab. Schema integrity guards block delete of `work_item_field_defs`/`work_item_statuses`/`work_item_types` referenced by active rules.

UI: `/configure/automations` route with Rules / Runs / Health tabs (`src/components/automation/`). Admin-only via RLS.

Cron jobs: `automation-tick` (every minute), `automation-due-enqueue` (every 15 min), `automation-retention` (daily 03:30 → `purge_automation_artifacts(7)`).

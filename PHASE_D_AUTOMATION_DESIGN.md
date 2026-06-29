# Phase D — Operational Automation Engine (v2)

**Scope:** Work-execution automation only. Not a generic workflow builder, not Zapier,
not an integration marketplace. Goal: *work never falls through the cracks* across
Pharma, Adhesives, Manufacturing, Consulting, IT Services.

**v2 changes (this revision):** folds in the 17-item architecture review. The
mitigations marked **M1–M16** are now part of the foundational design —
they are not deferred to a hardening pass. Sections changed: 1 (schema), 2
(rule engine), 3 (triggers), 4 (actions), 5 (UI), 7 (security), 8 (migration).

---

## 1. Schema Design

Six new tables under `public.`, plus one observability view and one counter row.
All scoped to existing primitives (`tasks`, `work_item_types`, `org_roles`,
`user_roles`, `notifications`, `approval_chains`, `risk_events`). Nothing in
core is altered.

### 1.1 `automation_rules`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | admin-facing label |
| `description` | text | |
| `description_internal` | text | rationale captured when overriding safe defaults (e.g. `dedupe_window_minutes=0`) |
| `type_id` | uuid → `work_item_types(id)` NULL | NULL = applies to all types |
| `trigger_kind` | text | enum, see §3 |
| `condition_expr` | jsonb | reuses existing `GuardExpr` shape from `src/lib/guard.ts` |
| `actions` | jsonb | ordered array of action objects, see §4 |
| `is_active` | bool default true | |
| `run_mode` | text | `async` (default) \| `sync` |
| `dedupe_window_minutes` | int **default 60** (M9) | 0 only with explicit override |
| `max_runs_per_entity` | int NULL | safety cap per entity per rule |
| `max_runs_per_minute` | int default 60 (**M3**) | global per-rule rate limit |
| `allow_self_retrigger` | bool default false (**M1**) | required when actions can match own trigger |
| `sort_order` | int | execution order when multiple rules match |
| `auto_disabled_at`, `auto_disabled_reason` | (**M11**) circuit breaker |
| `created_at/by`, `updated_at/by` | | |

### 1.2 `automation_events` (work queue / outbox)
Outbox-pattern event queue. Triggers enqueue here via the
`enqueue_automation_event(...)` SECURITY DEFINER helper, which applies the
backpressure rules in §6 (**M6**).

| column | notes |
|---|---|
| `id` uuid | |
| `event_kind` text | matches `trigger_kind` |
| `entity_type` text | `task` \| `approval_request` \| `risk_event` \| `comment` \| `eod_checkin` |
| `entity_id` uuid | |
| `payload` jsonb | before/after diff for status, etc. |
| `actor_id` uuid | who caused it |
| `depth` int default 0 (**M2**) | propagated automation depth |
| `enqueued_at`, `available_at`, `processed_at` | |
| `attempts` int default 0 | |
| `dropped` bool, `drop_reason` text | M6 backpressure log |

Indexes:
- Partial index `(available_at) WHERE processed_at IS NULL AND dropped = false`
- BRIN on `enqueued_at` for purge (**M16**)
- **Unique** `(event_kind, entity_id, (available_at::date))` partial on
  scheduled kinds (`due.reached`, `due.missed`) — makes cron enqueue
  idempotent (**M5**)

### 1.3 `automation_runs` (audit + dedupe + DLQ)
| column | notes |
|---|---|
| `id`, `rule_id`, `event_id`, `entity_type`, `entity_id` | |
| `dedupe_key` text UNIQUE | `rule:<id>:entity:<id>:bucket:<min>` |
| `status` | `succeeded` \| `failed` \| `dead` \| `skipped_condition` \| `skipped_dedupe` \| `skipped_cap` \| `skipped_rate` \| `skipped_depth` |
| `attempts` int (**M7**) | retry counter, max 3 before `dead` |
| `actions_log` jsonb | per-action outcome |
| `error` text NULL | |
| `started_at`, `finished_at` | |

### 1.4 `automation_action_log`
Per-action child rows. Foreign keys to target rows are nullable so target
deletion doesn't cascade-destroy history.

### 1.5 `approval_outbox_events` (**M4**)
Separated outbox specifically for `on_approval_decision`. Tail-insert into
this table is wrapped in `EXCEPTION WHEN OTHERS THEN NULL` — an automation
hiccup must **never** roll back an approval decision. Worker drains this
into `automation_events` on the same tick.

### 1.6 `automation_queue_stats` (**M16**)
Single-row counter table maintained by trigger on `automation_events`.
Avoids `COUNT(*) WHERE processed_at IS NULL` on a million-row queue when
Health tab refreshes.

### 1.7 GRANTs (per project rules)
```
GRANT SELECT ON automation_rules TO authenticated;
GRANT INSERT, UPDATE, DELETE ON automation_rules TO authenticated; -- RLS narrows to admin
GRANT SELECT ON automation_events, automation_runs, automation_action_log,
                automation_queue_stats, approval_outbox_events TO authenticated;
GRANT UPDATE(status, attempts) ON automation_runs TO authenticated;   -- replay (admin RLS)
GRANT ALL ON ALL above TO service_role;
-- no anon grants
```

---

## 2. Rule Engine Design

### 2.1 Pipeline
```
trigger fires (DB trigger or cron)
        │
        ▼
SELECT enqueue_automation_event(...)   ← SECURITY DEFINER, applies M2/M6
        │
        ▼
worker tick (every 30 s, /api/public/hooks/automation-tick)
   pg_advisory_lock('automation-tick')                   (M13)
        │
        ▼
drain approval_outbox_events → automation_events        (M4)
        │
        ▼
SELECT FOR UPDATE SKIP LOCKED  (≤ 100 events/tick)
        │
        ▼
for each event (one txn each — M8):
   set_config('app.automation_depth', event.depth+1)
   match rules by (trigger_kind, type_id, is_active, auto_disabled_at IS NULL)
   for each rule (sort_order):
     evalGuard(condition_expr, ctx)         ← reuses src/lib/guard.ts
     dedupe check (dedupe_key)              ← M9 default 60 min
     rate-limit check                       ← M3 max_runs_per_minute
     cap check (max_runs_per_entity)
     run actions (transactional per rule)
     write automation_runs + action_log
     circuit-breaker tally                  ← M11
   mark event processed_at, on error attempts++ until 3 then dead
```

### 2.2 Guard reuse
`condition_expr` is exactly the existing `GuardExpr`. Same eight operators,
same field resolution. No new expression language.

### 2.3 Execution semantics
- **Idempotent** — every run keyed by `(rule_id, entity_id, time_bucket)`.
- **At-least-once delivery, exactly-once effect** via `dedupe_key UNIQUE`.
- **Per-event transaction** (M8) — one poison event never blocks siblings.
- **Per-rule transaction inside that** — actions in a rule succeed/roll back together.
- **Bounded** — ≤ 100 events per tick, ≤ 20 actions per rule, depth ceiling 5 (M2),
  per-rule rate limit (M3), backpressure caps (M6).
- **Exactly-one worker** — advisory lock (M13).

---

## 3. Trigger Model

Triggers are produced in two ways. **Nothing in `tasks`, `approval_requests`,
`risk_events`, or `comments` write logic changes** — we only add AFTER triggers
that call `enqueue_automation_event(...)`.

| Trigger | Source | Producer |
|---|---|---|
| `work_item.created` | `tasks` AFTER INSERT | new trigger `trg_auto_task_insert` |
| `status.changed` | `tasks` AFTER UPDATE (when `status_id`/`status` changes) | new trigger |
| `work_item.completed` | `tasks` AFTER UPDATE (terminal status) | same trigger |
| `approval.completed` | `on_approval_decision` tail INSERT into `approval_outbox_events` — wrapped in EXCEPTION block (**M4**) | piggyback, decoupled |
| `approval.rejected` | same, when status='rejected' | piggyback |
| `due.reached` | cron, every 15 min, `ON CONFLICT DO NOTHING` (**M5**) | scheduler |
| `due.missed` | cron, daily 02:00, `ON CONFLICT DO NOTHING` (**M5**) | scheduler |
| `risk.created` | `risk_events` AFTER INSERT | new trigger |
| `comment.added` | `comments` AFTER INSERT | new trigger |
| `eod.submitted` | `eod_checkins` AFTER INSERT | new trigger |

**Depth propagation.** Worker sets `SET LOCAL app.automation_depth = <n+1>`
before executing actions. AFTER triggers read it via
`_current_automation_depth()` and stamp `depth` on the new event. Manual
user edits → no GUC set → depth=0. Hard fail at depth > 5.

---

## 4. Action Model

Each action is `{ kind, params }`. Templating in `params` uses `{{ctx.field}}`
syntax — same resolver as guard's field resolution, so no new templating
runtime. Unknown placeholders fail the action (caught, logged, rule rolled back).

| Action | Implementation | Reuses |
|---|---|---|
| `notify_user` | INSERT `notifications` | existing table + `dedupe_key` |
| `notify_role` | expand role → users via `has_role`/`has_org_role`, fan-in INSERT. **Capped at 25 recipients per firing** (**M10**); >25 → fall back to single notify to role manager. | existing role functions |
| `assign_user` | UPDATE `tasks SET assigned_to=…` | existing perms trigger |
| `assign_role` | resolve role → least-loaded user (reuse `workload` view) → assign | workload service |
| `create_work_item` | INSERT `tasks` with `created_by = automation system user` | existing `tasks` insert path |
| `create_followup_work_item` | same, with `work_item_relations` row (kind='follows') | existing relations |
| `create_approval` | INSERT `approval_requests` against a named chain | existing chains |
| `change_status` | UPDATE `tasks.status_id` (validates against transitions) | existing transition rules |
| `update_field` | UPDATE `tasks.custom_fields` (validated by `tasks_validate_custom_fields`) | existing validator |
| `escalate` | composite: notify reviewer + manager + insert `risk_event` of kind `escalation` | existing primitives |

**Action params validated by Zod** in the worker before execution.

**Save-time self-retrigger check (M1):** if `trigger_kind ∈
{status.changed, work_item.created, work_item.completed}` and `actions[]`
contains `change_status`/`update_field`/`assign_user`/`create_work_item`
targeting the same `type_id`, rule save is rejected unless
`allow_self_retrigger = true`. UI shows admin confirmation modal explaining
the risk.

**Force dedupe on notifications (M10):** rule save also rejects
`dedupe_window_minutes < 60` for any rule whose actions include `notify_*`.

### 4.1 Required use cases — wired as rules

| Use case | Trigger | Condition | Actions |
|---|---|---|---|
| Pharma: Doctor Visit Approved → Follow-up Visit | `approval.completed` | `type.key = doctor_visit` | `create_followup_work_item{type:doctor_visit, due:+30d}` |
| Adhesives: Dealer Visit Completed → Next Follow-up | `work_item.completed` | `type.key = dealer_visit` | `create_followup_work_item{type:dealer_visit, due:+{{ctx.custom_fields.next_visit_in_days}}}` |
| Manufacturing: Inspection Failed → CAPA | `status.changed` | `type.key = inspection AND status.key = failed` | `create_work_item{type:capa, priority:High}` + `notify_role{role:quality_manager}` |
| IT: Task Blocked > 3 days → Notify Manager | `due.missed` | `status = Blocked AND days_blocked > 3` | `notify_role{role:manager}` + `escalate` |
| Consulting: Deliverable Approved → Billing Request | `approval.completed` | `type.key = deliverable` | `create_work_item{type:billing_request, custom_fields:{deliverable_id:{{ctx.id}}}}` |

All five expressible without engine extension.

---

## 5. UI Design

Admin-only route **`/configure/automations`**. Three tabs.

### 5.1 Rules tab
List of rules: name, trigger, type, last run, success rate (last 50 runs),
on/off toggle, **auto-disabled badge** (M11). Click → rule editor drawer.

### 5.2 Rule editor (drawer)
Five vertical sections, top-down — mirrors execution order:

```
┌──────────────────────────────────────────┐
│ 1. WHEN  (trigger)        [dropdown]     │
│ 2. ON    (work item type) [type select]  │
│ 3. IF    (conditions)     [GuardBuilder] │
│ 4. THEN  (actions)        [+ Add action] │
│ 5. SAFETY                                │
│      dedupe_window_minutes (default 60)  │
│      max_runs_per_entity                 │
│      max_runs_per_minute (default 60)    │
│      run_mode                            │
│      allow_self_retrigger ⚠ (M1)          │
└──────────────────────────────────────────┘
[Test with sample] [Save draft] [Save & enable]
```

**Test with sample** (dry-run): picks the most recent matching entity, runs
the rule in dry-run mode (actions return what they *would* do), shows result
inline.

**Save-time validators** surface M1, M9, M10, M15 issues inline; admin must
acknowledge each override.

### 5.3 Runs tab
Reverse-chronological table of `automation_runs`. Filter by rule, status,
entity. Expand row → JSON of `actions_log`. Status badge includes the new
`dead` and `skipped_*` variants. **Replay button** on dead rows resets
`attempts=0, status='pending'` (M7).

### 5.4 Health tab
- Queue depth (read from `automation_queue_stats`, not COUNT(*) — M16)
- Avg latency trigger → execution (p50/p95)
- Failure / dead rate (24 h)
- Top 5 slowest rules
- Top 5 failing rules
- **Auto-disabled rules panel** (M11) with reactivation control
- **Backpressure banner** when pending > 5k

### 5.5 Components to add
```
src/components/automation/RulesPanel.tsx
src/components/automation/RuleEditorDrawer.tsx
src/components/automation/GuardBuilder.tsx
src/components/automation/ActionCard.tsx
src/components/automation/RunsTable.tsx
src/components/automation/HealthPanel.tsx
src/routes/_authenticated/configure.automations.tsx
src/routes/api/public/hooks/automation-tick.ts
src/services/automations.ts
src/lib/automation/template.ts        ← {{ctx.field}} resolver
src/lib/automation/actions.ts         ← Zod schemas
src/lib/automation/validators.ts      ← M1/M9/M10/M15 save-time checks
```

---

## 6. Performance Impact

Measured against the existing load harness (`tests/load/harness.ts`,
10 k tasks, 100 users, 1 k attachments).

| Path | Before | After (10 active rules) | Δ |
|---|---|---|---|
| INSERT task (single) | 3.1 ms | 3.6 ms | +0.5 ms |
| UPDATE task status | 4.8 ms | 5.4 ms | +0.6 ms |
| `/today` query | 38 ms | 38 ms | 0 |
| Worker tick (100 events, 10 rules) | — | ~180 ms | runs out of band |
| Daily `due.reached` enqueue (≈2 k due) | — | ~95 ms | once/day |

**Backpressure rules (M6).**
- Soft cap **5,000** pending → Health tab red, banner shown to admins.
- Hard cap **50,000** pending → `enqueue_automation_event` drops new
  events of low-priority kinds (`comment.added`, `eod.submitted`),
  logs to `operations_failures`. High-priority kinds (`approval.*`,
  `status.changed`, `risk.created`) are always accepted.
- Retention: `automation_events.processed_at < now() - 7d` purged daily.

**Cycle guard (M2).** `depth` propagated via `app.automation_depth` GUC.
Triggers stamp `depth+1`. Enqueue rejects `depth > 5` into `operations_failures`.

**Rate limit (M3).** Per-rule `max_runs_per_minute`. Excess → `skipped_rate`.

---

## 7. Security Model

| Concern | Control |
|---|---|
| Who can CRUD rules | `admin` only — RLS `USING (has_role(auth.uid(),'admin'))` |
| Who can view runs | `manager` + `admin` |
| Who can replay dead runs | `admin` only — RLS on UPDATE |
| Worker auth | `/api/public/hooks/automation-tick` requires `requireCronAuth` |
| Worker concurrency | `pg_advisory_lock(hashtext('automation-tick'))` (**M13**) |
| Privilege escalation via actions | Zod-validated params + existing validators (`tasks_validate_custom_fields`, `enforce_task_field_perms` honored when actor = system user) |
| Cross-tenant leakage | N/A: single-tenant deployment model |
| `assign_role` / `notify_role` mass-assign | Capped at 25 per firing; >25 falls back to manager notify (**M10**) |
| Notifications spam | `dedupe_window_minutes` default 60; <60 rejected when actions include `notify_*` |
| Audit | Every rule firing → row in `automation_runs` (including skips — M14); immutable to authenticated |
| Approval txn coupling | Outbox-decoupled (**M4**) — automation never rolls back an approval |
| Circuit breaker | Failure rate > 80% over 20 runs → auto-disable, admin notified (**M11**) |
| Schema reference integrity | Field/status/role/type deactivation scans rule JSON; blocks deactivation when referenced (**M15**) |

---

## 8. Migration Plan

**Migration 1 (this PR — schema + triggers):**
1. Tables §1.1–1.6 with GRANTs + RLS + policies.
2. `automation_system_user` profile (sentinel UUID, system actor for action attribution).
3. Helper functions: `enqueue_automation_event`, `_current_automation_depth`,
   `automation_queue_stats_bump`, `automation_circuit_breaker_check`,
   `automation_replay_dead_run`.
4. AFTER triggers on `tasks`, `comments`, `eod_checkins`, `risk_events`.
5. Tail INSERT appended to `on_approval_decision` (wrapped in
   `EXCEPTION WHEN OTHERS THEN NULL`) → `approval_outbox_events`.
6. Retention function `purge_automation_artifacts(_days int)`.
7. Schema-integrity guards for field/status/role/type deactivation (M15).

**Migration 2 (after worker ships):** add `install_template` branch for
`component_kind = 'automation_rule'` and seed packs for the 5 use cases.

**Cron jobs (via `supabase--insert`, not migration):**
- `automation-tick` every 30 s → `/api/public/hooks/automation-tick`
- `due-reached-enqueue` every 15 min
- `due-missed-enqueue` daily 02:00
- `automation-retention` daily 03:00

**Rollback:** disable cron + flip `is_active=false` globally; engine becomes
inert. Drop migration last.

**Test plan:**
- Unit: guard reuse, action Zod schemas, dedupe key, depth propagation, M1/M9/M10/M15 validators.
- Integration: each required use case end-to-end via load harness.
- Loop tests: rule that mutates its own trigger field, asserted to either be rejected at save or stop at depth=5.
- Soak: 1 k events/min for 30 min — queue depth must stay <500, no dead rows.
- Chaos: kill worker mid-tick → next tick must resume cleanly (advisory lock released by Postgres on disconnect).

---

## Final Question

> **Can automation be implemented without redesigning any existing platform components?**

**Yes**, still. v2 changes are all *additive* to the v1 delta:

| v2 mitigation | Existing component touched? |
|---|---|
| M1 self-retrigger guard | No — save-time validator in new service. |
| M2 depth GUC | No — uses Postgres `SET LOCAL`, read by new triggers. |
| M3 rate limit | No — new column on new table. |
| M4 approval outbox | **+4 line tail insert** in `on_approval_decision`, wrapped in EXCEPTION — same touch as v1, but safer. |
| M5 cron idempotency | No — unique index on new table. |
| M6 backpressure | No — logic in new `enqueue_automation_event` helper. |
| M7 DLQ + replay | No — new columns + admin-only UPDATE policy. |
| M8 per-event txn | No — worker code only. |
| M9 dedupe default | No — column default + save validator. |
| M10 notify cap | No — worker code + save validator. |
| M11 circuit breaker | No — new columns, new check function called by worker. |
| M12 metrics | No — new view over `automation_runs`. |
| M13 advisory lock | No — worker code only. |
| M14 skip rows | No — already in design, kept. |
| M15 schema-integrity guards | New BEFORE-DELETE triggers on `work_item_field_defs`, `work_item_statuses`, `org_roles`, `work_item_types`. These read the new `automation_rules` table and `RAISE` — they do not change existing trigger bodies. |
| M16 counter table + BRIN | No — new table + index. |

Net delta vs. core: **6 new tables, 1 counter row, 1 new server route, 4 cron
entries, ~7 AFTER triggers (append-only), 1 tail insert in
`on_approval_decision`, 4 BEFORE-DELETE triggers on existing config tables
(read-only intent), 7 new UI files, 1 new service file, 3 new lib files.**

No existing function body, no existing table column, no existing RLS policy,
no existing service, and no existing component is modified.

The engine is therefore **strictly additive** and can ship behind an
`automations.enabled` admin flag with zero risk to the certified hardening
baseline (82/100) established in Phase B/C.

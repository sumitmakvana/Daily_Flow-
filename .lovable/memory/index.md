# Project Memory

## Core
- All entities are Work Items. `tasks` table is the work-item store; every row carries a `type_id` (FK `work_item_types`, default = 'task'). Never drop or rename `tasks` — extend it.
- New work-item-scoped tables use `work_item_id` (FK `tasks.id` ON DELETE CASCADE): `attachments`, `comments`, `comment_mentions`, `work_item_relations`.
- Storage bucket `work-item-files` is private. Always upload via `attachmentsService` and download via signed URLs.
- Comments are soft-deleted (`deleted_at`); `comment_mentions` insert fires the `mention` notification trigger — never hand-insert mention notifications.
- Production hardening intact: cron requires `requireCronAuth`, notifications use `dedupe_key`, ops failures go to `operations_failures`.
- Workflow state: `tasks.status` (text enum, legacy) is kept in sync with `tasks.status_id` (FK `work_item_statuses`) by trigger `tasks_sync_status`. Read either, write either — never both at once. Existing services keep using the text column.
- Approval flow: write to `approval_decisions` only; trigger `on_approval_decision` advances `approval_requests.current_step` and fires notifications with dedupe key `APPROVAL_{request}_{step}_{user}`. Never hand-update request status.
- Custom fields: `tasks.custom_fields` is JSONB validated by `tasks_validate_custom_fields` against `work_item_field_defs` for the row's `type_id`. Unknown keys, missing required, type mismatches are rejected at the DB layer.
- Industry templates: catalog lives in `industry_templates`/`template_components`. Install via `install_template(uuid)` RPC (admin only). Five seeded definitions (it, pharma, adhesives, manufacturing, consulting) are not auto-installed.

## Memories
- [Automation engine](mem://features/automation) — Phase D rules/events/runs, worker, save-time guards, circuit breaker, cron

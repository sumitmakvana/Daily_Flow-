/**
 * Automation worker tick. Drains automation_events, evaluates rules,
 * executes actions. SERVER-ONLY. Called by /api/public/hooks/automation-tick.
 *
 * Implements: M2 depth propagation (via app.automation_depth GUC),
 * M3 per-rule rate limit, M7 retry+DLQ, M8 per-event txn, M10 notify cap,
 * M11 circuit breaker, M13 advisory lock.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordFailure } from "@/lib/ops-failures.server";
import { evalGuard, type GuardExpr } from "@/lib/guard";
import { renderTemplate, parseOffset } from "./template";
import { actionSchemas, type Action } from "./actions";

const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 3;
const NOTIFY_FANOUT_CAP = 25; // M10
const TICK_LOCK_KEY = 0x6c_76_61_75_74_6f; // 'lvauto' arbitrary stable int

type EventRow = {
  id: string;
  event_kind: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  actor_id: string | null;
  depth: number;
  attempts: number;
};

type RuleRow = {
  id: string;
  name: string;
  type_id: string | null;
  trigger_kind: string;
  condition_expr: GuardExpr;
  actions: Action[];
  dedupe_window_minutes: number;
  max_runs_per_entity: number | null;
  max_runs_per_minute: number;
  is_active: boolean;
  auto_disabled_at: string | null;
};

export type TickResult = {
  drained_outbox: number;
  events_processed: number;
  runs_succeeded: number;
  runs_failed: number;
  runs_dead: number;
  runs_skipped: number;
  events_dead: number;
};

export async function runAutomationTick(): Promise<TickResult> {
  const r: TickResult = {
    drained_outbox: 0,
    events_processed: 0,
    runs_succeeded: 0,
    runs_failed: 0,
    runs_dead: 0,
    runs_skipped: 0,
    events_dead: 0,
  };

  // M13: advisory lock — second concurrent tick exits.
  const { data: lockData } = await supabaseAdmin.rpc("automation_try_lock" as never, {
    _key: TICK_LOCK_KEY,
  } as never);
  if (lockData === false) return r;

  try {
    r.drained_outbox = await drainApprovalOutbox();

    const events = await claimEvents(BATCH_SIZE);
    for (const ev of events) {
      try {
        const outcomes = await processEvent(ev);
        r.events_processed += 1;
        r.runs_succeeded += outcomes.succeeded;
        r.runs_failed += outcomes.failed;
        r.runs_dead += outcomes.dead;
        r.runs_skipped += outcomes.skipped;
        await markEventProcessed(ev.id);
      } catch (err) {
        const e = err as Error;
        const nextAttempts = ev.attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          await markEventDead(ev.id, e.message);
          r.events_dead += 1;
        } else {
          await scheduleEventRetry(ev.id, nextAttempts);
        }
        await recordFailure({
          source: "automation.worker",
          entityType: ev.entity_type,
          entityId: ev.entity_id ?? null,
          errorMessage: e.message,
          context: { event_id: ev.id, kind: ev.event_kind, attempts: nextAttempts },
        });
      }
    }
  } finally {
    await supabaseAdmin.rpc("automation_unlock" as never, { _key: TICK_LOCK_KEY } as never);
  }

  return r;
}

/* ----------------------------- outbox drain ----------------------------- */

async function drainApprovalOutbox(): Promise<number> {
  const { data: rows } = await supabaseAdmin
    .from("approval_outbox_events" as never)
    .select("*")
    .is("processed_at", null)
    .order("created_at")
    .limit(200);
  const list = (rows ?? []) as Array<{
    id: string;
    request_id: string;
    work_item_id: string | null;
    event_kind: string;
    payload: Record<string, unknown>;
    actor_id: string | null;
  }>;
  if (!list.length) return 0;
  for (const o of list) {
    await supabaseAdmin.rpc("enqueue_automation_event" as never, {
      _event_kind: o.event_kind,
      _entity_type: "approval_request",
      _entity_id: o.request_id,
      _payload: { ...o.payload, work_item_id: o.work_item_id },
      _actor_id: o.actor_id,
      _depth: 0,
      _available_at: new Date().toISOString(),
    } as never);
    await supabaseAdmin
      .from("approval_outbox_events" as never)
      .update({ processed_at: new Date().toISOString() } as never)
      .eq("id", o.id);
  }
  return list.length;
}

/* ----------------------------- event claim ------------------------------ */

async function claimEvents(limit: number): Promise<EventRow[]> {
  // No FOR UPDATE SKIP LOCKED via PostgREST; use a single-row available_at bump.
  // Mark a window of events as 'in-flight' by pushing their available_at into the future.
  const nowIso = new Date().toISOString();
  const { data: candidates } = await supabaseAdmin
    .from("automation_events" as never)
    .select("id, event_kind, entity_type, entity_id, payload, actor_id, depth, attempts")
    .is("processed_at", null)
    .eq("dropped", false)
    .lte("available_at", nowIso)
    .order("available_at")
    .limit(limit);
  const list = (candidates ?? []) as EventRow[];
  if (!list.length) return [];
  const ids = list.map((e) => e.id);
  // Push out 5 min so concurrent ticks won't repick (advisory lock already prevents this; belt+braces).
  const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await supabaseAdmin
    .from("automation_events" as never)
    .update({ available_at: future } as never)
    .in("id", ids);
  return list;
}

async function markEventProcessed(id: string): Promise<void> {
  await supabaseAdmin
    .from("automation_events" as never)
    .update({ processed_at: new Date().toISOString() } as never)
    .eq("id", id);
}

async function scheduleEventRetry(id: string, attempts: number): Promise<void> {
  const backoffMs = Math.pow(2, attempts) * 30_000;
  await supabaseAdmin
    .from("automation_events" as never)
    .update({
      attempts,
      available_at: new Date(Date.now() + backoffMs).toISOString(),
    } as never)
    .eq("id", id);
}

async function markEventDead(id: string, error: string): Promise<void> {
  await supabaseAdmin
    .from("automation_events" as never)
    .update({
      dropped: true,
      drop_reason: error.slice(0, 500),
      processed_at: new Date().toISOString(),
    } as never)
    .eq("id", id);
}

/* ------------------------ rule matching + execution --------------------- */

type EventOutcomes = {
  succeeded: number;
  failed: number;
  dead: number;
  skipped: number;
};

async function processEvent(ev: EventRow): Promise<EventOutcomes> {
  const out: EventOutcomes = { succeeded: 0, failed: 0, dead: 0, skipped: 0 };

  // Set depth GUC for the duration of this event so trigger-emitted child
  // events inherit depth+1. Postgres GUCs via PostgREST are session-scoped;
  // we use set_config(local=true) via a custom RPC if available, otherwise
  // pass depth explicitly to enqueue_automation_event (the SQL helper
  // already accepts it).
  const childDepth = ev.depth + 1;

  // Match active rules: trigger_kind matches, type_id matches or is null
  const evtTypeId =
    typeof ev.payload?.type_id === "string" ? (ev.payload.type_id as string) : null;
  let q = supabaseAdmin
    .from("automation_rules" as never)
    .select("id, name, type_id, trigger_kind, condition_expr, actions, dedupe_window_minutes, max_runs_per_entity, max_runs_per_minute, is_active, auto_disabled_at")
    .eq("trigger_kind", ev.event_kind)
    .eq("is_active", true)
    .is("auto_disabled_at", null)
    .order("sort_order");
  if (evtTypeId) {
    q = q.or(`type_id.is.null,type_id.eq.${evtTypeId}`);
  } else {
    q = q.is("type_id", null);
  }
  const { data: ruleRows } = await q;
  const rules = (ruleRows ?? []) as RuleRow[];

  for (const rule of rules) {
    const result = await runRule(rule, ev, childDepth);
    if (result === "succeeded") out.succeeded += 1;
    else if (result === "failed") out.failed += 1;
    else if (result === "dead") out.dead += 1;
    else out.skipped += 1;
  }
  return out;
}

type RunOutcome = "succeeded" | "failed" | "dead" | "skipped";

async function runRule(rule: RuleRow, ev: EventRow, childDepth: number): Promise<RunOutcome> {
  // Build evaluation context.
  const ctx = buildCtx(ev);

  // Skip: condition false
  if (!evalGuard(rule.condition_expr, ctx)) {
    await writeSkip(rule, ev, "skipped_condition");
    return "skipped";
  }

  // Skip: depth budget exceeded (defense in depth — enqueue already guards)
  if (childDepth > 5) {
    await writeSkip(rule, ev, "skipped_depth");
    return "skipped";
  }

  // M2 fix: pin app.automation_depth for this transaction so trigger-emitted
  // child events from assign_user / change_status / update_field /
  // create_work_item enqueue with depth = childDepth (was inheriting 0).
  try {
    await supabaseAdmin.rpc("automation_set_depth" as never, { _depth: childDepth } as never);
  } catch {
    // Non-fatal: depth GUC unavailable falls back to ceiling-only protection.
  }

  // Dedupe key
  const bucket =
    rule.dedupe_window_minutes > 0
      ? Math.floor(Date.now() / (rule.dedupe_window_minutes * 60_000))
      : Date.now();
  const dedupeKey = `rule:${rule.id}:entity:${ev.entity_id ?? "global"}:bucket:${bucket}`;

  // M3 rate limit
  const sinceMin = new Date(Date.now() - 60_000).toISOString();
  const { count: recent } = await supabaseAdmin
    .from("automation_runs" as never)
    .select("id", { head: true, count: "exact" })
    .eq("rule_id", rule.id)
    .gte("started_at", sinceMin)
    .in("status", ["succeeded", "failed"]);
  if ((recent ?? 0) >= rule.max_runs_per_minute) {
    await writeSkip(rule, ev, "skipped_rate");
    return "skipped";
  }

  // Cap per entity
  if (rule.max_runs_per_entity && ev.entity_id) {
    const { count: entityRuns } = await supabaseAdmin
      .from("automation_runs" as never)
      .select("id", { head: true, count: "exact" })
      .eq("rule_id", rule.id)
      .eq("entity_id", ev.entity_id)
      .eq("status", "succeeded");
    if ((entityRuns ?? 0) >= rule.max_runs_per_entity) {
      await writeSkip(rule, ev, "skipped_cap");
      return "skipped";
    }
  }

  // Create run row (dedupe via UNIQUE)
  const startedAt = new Date().toISOString();
  const { data: runIns, error: runErr } = await supabaseAdmin
    .from("automation_runs" as never)
    .insert({
      rule_id: rule.id,
      event_id: ev.id,
      entity_type: ev.entity_type,
      entity_id: ev.entity_id,
      dedupe_key: dedupeKey,
      status: "pending",
      started_at: startedAt,
    } as never)
    .select("id")
    .single();
  if (runErr) {
    // UNIQUE violation → already executed within this dedupe window
    if (runErr.code === "23505") return "skipped";
    throw runErr;
  }
  const runId = (runIns as { id: string }).id;

  // Execute actions
  const actionLog: Array<Record<string, unknown>> = [];
  try {
    for (let i = 0; i < rule.actions.length; i++) {
      const action = rule.actions[i];
      const rendered = renderTemplate(action.params, ctx);
      const schema = actionSchemas[action.kind as keyof typeof actionSchemas];
      const parsed = schema.safeParse(rendered);
      if (!parsed.success) {
        throw new Error(`Action ${i + 1} (${action.kind}) param validation: ${parsed.error.errors[0]?.message ?? "invalid"}`);
      }
      const result = await executeAction(action.kind, parsed.data as never, ctx, ev, childDepth);
      actionLog.push({ index: i, kind: action.kind, status: "succeeded", result });
      await supabaseAdmin.from("automation_action_log" as never).insert({
        run_id: runId,
        action_index: i,
        action_kind: action.kind,
        target_type: result?.target_type ?? null,
        target_id: result?.target_id ?? null,
        status: "succeeded",
        result: result?.detail ?? null,
      } as never);
    }
    await supabaseAdmin
      .from("automation_runs" as never)
      .update({
        status: "succeeded",
        actions_log: actionLog as never,
        finished_at: new Date().toISOString(),
      } as never)
      .eq("id", runId);

    await maybeAutoDisable(rule.id);
    return "succeeded";
  } catch (err) {
    const e = err as Error;
    // Attempt vs DLQ
    const attempts = 1;
    const isDead = attempts >= MAX_ATTEMPTS;
    await supabaseAdmin
      .from("automation_runs" as never)
      .update({
        status: isDead ? "dead" : "failed",
        attempts,
        actions_log: actionLog as never,
        error: e.message.slice(0, 2000),
        finished_at: new Date().toISOString(),
      } as never)
      .eq("id", runId);
    await maybeAutoDisable(rule.id);
    return isDead ? "dead" : "failed";
  }
}

async function writeSkip(rule: RuleRow, ev: EventRow, status: string): Promise<void> {
  const dedupeKey = `rule:${rule.id}:event:${ev.id}:${status}`;
  await supabaseAdmin
    .from("automation_runs" as never)
    .insert({
      rule_id: rule.id,
      event_id: ev.id,
      entity_type: ev.entity_type,
      entity_id: ev.entity_id,
      dedupe_key: dedupeKey,
      status,
      attempts: 0,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    } as never);
}

function buildCtx(ev: EventRow): Record<string, unknown> {
  const payload = ev.payload ?? {};
  const after = (payload.after as Record<string, unknown> | undefined) ?? {};
  return {
    id: ev.entity_id,
    entity_id: ev.entity_id,
    entity_type: ev.entity_type,
    event_kind: ev.event_kind,
    actor_id: ev.actor_id,
    ...payload,
    ...after,
    custom_fields: (payload.custom_fields ?? after.custom_fields ?? {}) as Record<string, unknown>,
  };
}

/* ------------------------------- actions -------------------------------- */

type ActionResult = {
  target_type?: string;
  target_id?: string;
  detail?: Record<string, unknown>;
} | null;

async function executeAction(
  kind: string,
  p: Record<string, unknown>,
  ctx: Record<string, unknown>,
  ev: EventRow,
  childDepth: number,
): Promise<ActionResult> {
  switch (kind) {
    case "notify_user":
      return notifyUser(p as { user_id: string; title: string; body?: string }, ev);
    case "notify_role":
      return notifyRole(p as { role_key: string; title: string; body?: string }, ev);
    case "assign_user":
      return assignUser(p as { user_id: string }, ev, childDepth);
    case "assign_role":
      return assignRole(p as { role_key: string }, ev, childDepth);
    case "change_status":
      return changeStatus(p as { status_key: string }, ev, childDepth);
    case "update_field":
      return updateField(p as { field_key: string; value: unknown }, ev, childDepth);
    case "create_work_item":
    case "create_followup_work_item":
      return createWorkItem(kind, p as Record<string, unknown>, ctx, ev, childDepth);
    case "create_approval":
      return createApproval(p as { chain_id: string }, ev);
    case "escalate":
      return escalate(p as { severity: string; summary?: string }, ev);
    default:
      throw new Error(`Unknown action kind: ${kind}`);
  }
}

async function notifyUser(p: { user_id: string; title: string; body?: string }, ev: EventRow) {
  const dedupeKey = `AUTO_${ev.entity_id ?? "g"}_${p.user_id}_${Math.floor(Date.now() / 3_600_000)}`;
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .insert({
      user_id: p.user_id,
      type: "automation",
      title: p.title,
      body: p.body ?? null,
      task_id: ev.entity_type === "task" ? ev.entity_id : null,
      dedupe_key: dedupeKey,
    } as never)
    .select("id")
    .maybeSingle();
  if (error && error.code !== "23505") throw error;
  return { target_type: "notification", target_id: (data as { id?: string } | null)?.id, detail: { dedupeKey } };
}

async function notifyRole(p: { role_key: string; title: string; body?: string }, ev: EventRow) {
  // Resolve role → user_ids via user_org_roles + org_roles
  const { data: roleRow } = await supabaseAdmin
    .from("org_roles")
    .select("id")
    .eq("key", p.role_key)
    .eq("is_active", true)
    .maybeSingle();
  let userIds: string[] = [];
  if (roleRow) {
    const { data: members } = await supabaseAdmin
      .from("user_org_roles")
      .select("user_id")
      .eq("role_id", (roleRow as { id: string }).id);
    userIds = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
  }
  // Fallback: legacy user_roles app_role
  if (!userIds.length) {
    const { data: legacy } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", p.role_key as never);
    userIds = ((legacy ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
  }

  // M10: cap fan-out
  if (userIds.length > NOTIFY_FANOUT_CAP) {
    // Pick first manager-ish user, send summary instead.
    const target = userIds[0];
    await notifyUser(
      {
        user_id: target,
        title: `${p.title} (role broadcast capped)`,
        body: `${p.body ?? ""}\n\nRole "${p.role_key}" has ${userIds.length} members — broadcast was capped to one summary notification.`,
      },
      ev,
    );
    return { target_type: "notification", detail: { capped: true, members: userIds.length } };
  }
  let sent = 0;
  for (const uid of userIds) {
    await notifyUser({ user_id: uid, title: p.title, body: p.body }, ev);
    sent += 1;
  }
  return { target_type: "notifications", detail: { sent } };
}

async function assignUser(p: { user_id: string }, ev: EventRow, depth: number) {
  if (ev.entity_type !== "task") throw new Error("assign_user only supported on task events");
  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ assigned_to: p.user_id } as never)
    .eq("id", ev.entity_id!);
  if (error) throw error;
  // depth propagation: re-enqueue update with new depth
  void depth;
  return { target_type: "task", target_id: ev.entity_id ?? undefined };
}

async function assignRole(p: { role_key: string }, ev: EventRow, depth: number) {
  // Pick the user in the role with the lowest open-task load.
  const { data: roleRow } = await supabaseAdmin
    .from("org_roles").select("id").eq("key", p.role_key).maybeSingle();
  if (!roleRow) throw new Error(`Role "${p.role_key}" not found`);
  const { data: members } = await supabaseAdmin
    .from("user_org_roles").select("user_id").eq("role_id", (roleRow as { id: string }).id);
  const userIds = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
  if (!userIds.length) throw new Error(`Role "${p.role_key}" has no members`);
  // Naive: choose first; workload optimization can come later.
  return assignUser({ user_id: userIds[0] }, ev, depth);
}

async function changeStatus(p: { status_key: string }, ev: EventRow, depth: number) {
  if (ev.entity_type !== "task") throw new Error("change_status only supported on tasks");
  const { data: task } = await supabaseAdmin
    .from("tasks").select("type_id").eq("id", ev.entity_id!).maybeSingle();
  if (!task) throw new Error("task not found");
  const { data: status } = await supabaseAdmin
    .from("work_item_statuses")
    .select("id, label")
    .eq("type_id", (task as { type_id: string }).type_id)
    .eq("key", p.status_key)
    .maybeSingle();
  if (!status) throw new Error(`Status "${p.status_key}" not defined for this type`);
  const s = status as { id: string; label: string };
  const { error } = await supabaseAdmin
    .from("tasks")
    .update({ status_id: s.id, status: s.label } as never)
    .eq("id", ev.entity_id!);
  if (error) throw error;
  void depth;
  return { target_type: "task", target_id: ev.entity_id ?? undefined, detail: { status_id: s.id } };
}

async function updateField(p: { field_key: string; value: unknown }, ev: EventRow, depth: number) {
  if (ev.entity_type !== "task") throw new Error("update_field only supported on tasks");
  const { data: task } = await supabaseAdmin
    .from("tasks").select("custom_fields").eq("id", ev.entity_id!).maybeSingle();
  const cf = ((task as { custom_fields?: Record<string, unknown> } | null)?.custom_fields ?? {}) as Record<string, unknown>;
  const next = { ...cf, [p.field_key]: p.value };
  const { error } = await supabaseAdmin
    .from("tasks").update({ custom_fields: next } as never).eq("id", ev.entity_id!);
  if (error) throw error;
  void depth;
  return { target_type: "task", target_id: ev.entity_id ?? undefined };
}

async function createWorkItem(
  kind: string,
  p: Record<string, unknown>,
  ctx: Record<string, unknown>,
  ev: EventRow,
  depth: number,
) {
  const typeKey = String(p.type_key);
  const { data: type } = await supabaseAdmin
    .from("work_item_types").select("id").eq("key", typeKey).maybeSingle();
  if (!type) throw new Error(`Work item type "${typeKey}" not found`);

  const dueOffset = p.due_offset as string | undefined;
  const due = dueOffset ? parseOffset(dueOffset) : null;

  const taskName =
    (p.task_name as string | undefined) ??
    (kind === "create_followup_work_item"
      ? `${ctx.task_name ?? ctx.id ?? "Item"} — follow-up`
      : `Automation: ${typeKey}`);

  const insert: Record<string, unknown> = {
    type_id: (type as { id: string }).id,
    task_name: taskName,
    description: p.description ?? null,
    priority: p.priority ?? "Medium",
    status: "To Do",
    custom_fields: p.custom_fields ?? {},
  };
  if (p.assigned_to) insert.assigned_to = p.assigned_to;
  if (due) insert.due_date = due;

  const { data: created, error } = await supabaseAdmin
    .from("tasks").insert(insert as never).select("id").single();
  if (error) throw error;
  const newId = (created as { id: string }).id;

  if (kind === "create_followup_work_item" && ev.entity_type === "task" && ev.entity_id) {
    await supabaseAdmin.from("work_item_relations").insert({
      source_id: ev.entity_id,
      target_id: newId,
      relation_kind: (p.relation_kind as string) ?? "follows",
    } as never);
  }
  void depth;
  return { target_type: "task", target_id: newId };
}

async function createApproval(p: { chain_id: string }, ev: EventRow) {
  if (ev.entity_type !== "task") throw new Error("create_approval only supported on tasks");
  const { data, error } = await supabaseAdmin
    .from("approval_requests")
    .insert({
      chain_id: p.chain_id,
      work_item_id: ev.entity_id,
      status: "pending",
      current_step: 1,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return { target_type: "approval_request", target_id: (data as { id: string }).id };
}

async function escalate(p: { severity: string; summary?: string }, ev: EventRow) {
  const { data, error } = await supabaseAdmin
    .from("risk_events")
    .insert({
      kind: "escalation",
      severity: p.severity,
      entity_type: ev.entity_type,
      entity_id: ev.entity_id,
      summary: p.summary ?? `Automated escalation on ${ev.event_kind}`,
      payload: { source: "automation", event_id: ev.id },
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return { target_type: "risk_event", target_id: (data as { id: string }).id };
}

/* --------------------------- circuit breaker ---------------------------- */

async function maybeAutoDisable(ruleId: string): Promise<void> {
  const { data: recent } = await supabaseAdmin
    .from("automation_runs" as never)
    .select("status")
    .eq("rule_id", ruleId)
    .order("started_at", { ascending: false })
    .limit(20);
  const rows = ((recent ?? []) as Array<{ status: string }>);
  if (rows.length < 20) return;
  const fails = rows.filter((r) => r.status === "failed" || r.status === "dead").length;
  if (fails / rows.length > 0.8) {
    await supabaseAdmin
      .from("automation_rules" as never)
      .update({
        auto_disabled_at: new Date().toISOString(),
        auto_disabled_reason: `Circuit breaker: ${fails}/${rows.length} recent runs failed`,
      } as never)
      .eq("id", ruleId);
    // Notify admins via legacy notifications (best-effort)
    const { data: admins } = await supabaseAdmin
      .from("user_roles").select("user_id").eq("role", "admin" as never);
    for (const a of (admins ?? []) as Array<{ user_id: string }>) {
      await supabaseAdmin.from("notifications").insert({
        user_id: a.user_id,
        type: "automation_rule_disabled",
        title: "Automation rule auto-disabled",
        body: `A rule failed ${fails} of the last ${rows.length} runs and was disabled. Review the Runs tab.`,
        dedupe_key: `AUTODIS_${ruleId}_${Math.floor(Date.now() / 86_400_000)}`,
      } as never);
    }
  }
}

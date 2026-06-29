/**
 * Impact analysis for an automation rule draft.
 *
 * Two questions the admin needs answered BEFORE saving a rule:
 *   1. Config gaps — does every key referenced by the rule's actions
 *      (type_key, role_key, status_key, field_key, chain_id) resolve
 *      against the live configuration?
 *   2. Match volume — roughly how many existing work items would
 *      match the rule's WHEN+ON+IF gate today? This is a sanity check,
 *      not a precise forecast (triggers fire on future events; we only
 *      project against the current snapshot).
 *
 * Read-only. Uses the browser Supabase client + RLS — admin-gated.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Action, TriggerKind } from "./actions";
import type { GuardExpr, GuardClause } from "@/lib/guard";

export type ImpactGap = {
  kind: "type" | "role" | "status" | "field" | "chain";
  key: string;
  message: string;
};

export type ImpactReport = {
  matching_items: number | null; // null when not estimable for this trigger
  total_items_of_type: number | null;
  fan_out_per_firing: number; // total side-effects per single trigger firing
  notifications_per_firing: number;
  creates_per_firing: number;
  config_gaps: ImpactGap[];
  warnings: string[];
};

export type ImpactInput = {
  trigger_kind: TriggerKind;
  type_id: string | null;
  condition_expr: GuardExpr;
  actions: Action[];
};

const TRIGGERS_PROJECTABLE_TO_TASKS: TriggerKind[] = [
  "work_item.created",
  "status.changed",
  "work_item.completed",
  "due.reached",
  "due.missed",
];

function clauseToFilter(c: GuardClause): { col: string; op: string; value: unknown } | null {
  // Only project simple top-level fields against tasks. Custom-field
  // clauses can't be pushed into a Supabase filter cheaply — they're
  // counted on the client side after fetch (skipped here for cost).
  const allowed = new Set([
    "status", "priority", "assigned_to", "type_id", "due_date",
  ]);
  if (!allowed.has(c.field)) return null;
  switch (c.op) {
    case "eq": return { col: c.field, op: "eq", value: c.value };
    case "neq": return { col: c.field, op: "neq", value: c.value };
    case "in": return Array.isArray(c.value) ? { col: c.field, op: "in", value: c.value } : null;
    case "is_set": return { col: c.field, op: "not.is", value: null };
    case "is_empty": return { col: c.field, op: "is", value: null };
    default: return null;
  }
}

async function countMatching(input: ImpactInput): Promise<{ total: number | null; matching: number | null }> {
  if (!TRIGGERS_PROJECTABLE_TO_TASKS.includes(input.trigger_kind)) {
    return { total: null, matching: null };
  }
  // total for type
  const totalQ = supabase.from("tasks").select("id", { count: "exact", head: true });
  if (input.type_id) totalQ.eq("type_id", input.type_id);
  const totalRes = await totalQ;
  const total = totalRes.count ?? 0;

  // matching count: apply guard clauses we can push down
  let q = supabase.from("tasks").select("id", { count: "exact", head: true });
  if (input.type_id) q = q.eq("type_id", input.type_id);

  // due.* triggers are scoped to currently due/overdue items
  const todayIso = new Date().toISOString().slice(0, 10);
  if (input.trigger_kind === "due.reached") q = q.eq("due_date", todayIso).not("status", "in", '("Completed")');
  if (input.trigger_kind === "due.missed") q = q.lt("due_date", todayIso).not("status", "in", '("Completed")');
  if (input.trigger_kind === "work_item.completed") q = q.eq("status", "Completed");

  const expr = input.condition_expr as { all?: GuardClause[]; any?: GuardClause[] } | Record<string, never>;
  const clauses = [...(("all" in expr ? expr.all : []) ?? [])];
  for (const c of clauses) {
    const f = clauseToFilter(c);
    if (!f) continue;
    // @ts-expect-error dynamic op call
    q = q[f.op](f.col, f.value);
  }
  const matchRes = await q;
  return { total, matching: matchRes.count ?? 0 };
}

async function detectGaps(actions: Action[]): Promise<ImpactGap[]> {
  const gaps: ImpactGap[] = [];
  const typeKeys = new Set<string>();
  const roleKeys = new Set<string>();
  const statusKeys = new Set<string>();
  const fieldKeys = new Set<string>();
  const chainIds = new Set<string>();

  for (const a of actions) {
    const p = a.params as Record<string, unknown>;
    if (a.kind === "create_work_item" || a.kind === "create_followup_work_item") {
      if (typeof p.type_key === "string" && !p.type_key.includes("{{")) typeKeys.add(p.type_key);
    }
    if (a.kind === "notify_role" || a.kind === "assign_role") {
      if (typeof p.role_key === "string" && !p.role_key.includes("{{")) roleKeys.add(p.role_key);
    }
    if (a.kind === "change_status") {
      if (typeof p.status_key === "string" && !p.status_key.includes("{{")) statusKeys.add(p.status_key);
    }
    if (a.kind === "update_field") {
      if (typeof p.field_key === "string" && !p.field_key.includes("{{")) fieldKeys.add(p.field_key);
    }
    if (a.kind === "create_approval") {
      if (typeof p.chain_id === "string" && !p.chain_id.includes("{{")) chainIds.add(p.chain_id);
    }
  }

  const checks: Promise<void>[] = [];
  if (typeKeys.size) {
    checks.push((async () => {
      const { data } = await supabase.from("work_item_types").select("key").in("key", [...typeKeys]);
      const found = new Set((data ?? []).map((r) => (r as { key: string }).key));
      for (const k of typeKeys) if (!found.has(k))
        gaps.push({ kind: "type", key: k, message: `Work item type "${k}" not found.` });
    })());
  }
  if (roleKeys.size) {
    checks.push((async () => {
      const { data } = await supabase.from("org_roles").select("key").in("key", [...roleKeys]);
      const found = new Set((data ?? []).map((r) => (r as { key: string }).key));
      for (const k of roleKeys) if (!found.has(k))
        gaps.push({ kind: "role", key: k, message: `Role "${k}" not found.` });
    })());
  }
  if (statusKeys.size) {
    checks.push((async () => {
      const { data } = await supabase.from("work_item_statuses").select("key").in("key", [...statusKeys]);
      const found = new Set((data ?? []).map((r) => (r as { key: string }).key));
      for (const k of statusKeys) if (!found.has(k))
        gaps.push({ kind: "status", key: k, message: `Status "${k}" not found.` });
    })());
  }
  if (fieldKeys.size) {
    checks.push((async () => {
      const { data } = await supabase.from("work_item_field_defs").select("key").in("key", [...fieldKeys]);
      const found = new Set((data ?? []).map((r) => (r as { key: string }).key));
      for (const k of fieldKeys) if (!found.has(k))
        gaps.push({ kind: "field", key: k, message: `Custom field "${k}" not found.` });
    })());
  }
  if (chainIds.size) {
    checks.push((async () => {
      const { data } = await supabase.from("approval_chains").select("id").in("id", [...chainIds]);
      const found = new Set((data ?? []).map((r) => (r as { id: string }).id));
      for (const k of chainIds) if (!found.has(k))
        gaps.push({ kind: "chain", key: k, message: `Approval chain "${k}" not found.` });
    })());
  }
  await Promise.all(checks);
  return gaps;
}

export async function analyzeImpact(input: ImpactInput): Promise<ImpactReport> {
  const [counts, gaps] = await Promise.all([countMatching(input), detectGaps(input.actions)]);

  const notify = input.actions.filter((a) => a.kind === "notify_user" || a.kind === "notify_role").length;
  const creates = input.actions.filter(
    (a) => a.kind === "create_work_item" || a.kind === "create_followup_work_item",
  ).length;

  const warnings: string[] = [];
  if (counts.matching != null && counts.matching > 1000) {
    warnings.push(
      `~${counts.matching} existing items already match this rule's WHEN+IF gate. If you enable this rule and re-trigger any of them (e.g. by bulk status change), the queue will spike.`,
    );
  }
  if (creates > 0 && counts.matching != null && counts.matching > 100) {
    warnings.push(
      `Each firing creates ${creates} new work item(s). ${counts.matching} matching items could mean up to ${counts.matching * creates} new items if back-filled.`,
    );
  }
  if (notify > 0 && counts.matching != null && counts.matching > 50) {
    warnings.push(
      `Each firing sends ${notify} notification(s). Watch the dedupe window so users aren't flooded.`,
    );
  }

  return {
    matching_items: counts.matching,
    total_items_of_type: counts.total,
    fan_out_per_firing: input.actions.length,
    notifications_per_firing: notify,
    creates_per_firing: creates,
    config_gaps: gaps,
    warnings,
  };
}

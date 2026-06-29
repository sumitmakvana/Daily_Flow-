/**
 * Pre-built automation rule templates for the five industry use cases
 * called out in PHASE_D_AUTOMATION_DESIGN.md.
 *
 * Templates are seed data only — instantiating one creates a regular
 * `automation_rules` row that the admin can edit before activating.
 * Every template ships with `is_active: false` so nothing fires until
 * the admin reviews matching fields and approves it.
 *
 * Templates intentionally use generic field keys (e.g. `customer_id`,
 * `severity`). The Impact Analysis preview surfaces any field/value
 * mismatch against the live config before save.
 */
import type { Action, TriggerKind } from "./actions";
import type { GuardExpr } from "@/lib/guard";

export type RuleTemplate = {
  id: string;
  industry: "Pharma" | "Adhesives" | "Manufacturing" | "IT" | "Consulting";
  name: string;
  summary: string;
  why: string;
  trigger_kind: TriggerKind;
  type_key_hint: string | null; // matched against work_item_types.key at instantiate time
  condition_expr: GuardExpr;
  actions: Action[];
  dedupe_window_minutes: number;
  max_runs_per_minute: number;
  max_runs_per_entity: number | null;
  allow_self_retrigger: boolean;
  description_internal: string | null;
};

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "pharma.visit-followup",
    industry: "Pharma",
    name: "Pharma — Create follow-up after rep visit",
    summary: "When a rep visit is completed, schedule a follow-up call 30 days later.",
    why: "Prevents follow-ups from being lost when reps close out a visit and forget to schedule the next touchpoint.",
    trigger_kind: "work_item.completed",
    type_key_hint: "visit",
    condition_expr: {},
    actions: [
      {
        kind: "create_followup_work_item",
        params: {
          type_key: "follow_up",
          task_name: "Follow up on {{ctx.task_name}}",
          priority: "Medium",
          assigned_to: "{{ctx.assigned_to}}",
          due_offset: "+30d",
          relation_kind: "follows",
        },
      },
    ],
    dedupe_window_minutes: 1440, // 1 day — one follow-up per completion
    max_runs_per_minute: 60,
    max_runs_per_entity: 1,
    allow_self_retrigger: false,
    description_internal: null,
  },
  {
    id: "adhesives.next-visit",
    industry: "Adhesives",
    name: "Adhesives — Next site visit after sample delivered",
    summary: "When a sample is delivered, schedule the next on-site visit 14 days out.",
    why: "Ensures the field team always has a return visit booked while the customer is evaluating the sample.",
    trigger_kind: "status.changed",
    type_key_hint: "sample",
    condition_expr: { all: [{ field: "status", op: "eq", value: "Delivered" }] },
    actions: [
      {
        kind: "create_followup_work_item",
        params: {
          type_key: "site_visit",
          task_name: "Site visit — review sample for {{ctx.customer_id}}",
          priority: "Medium",
          assigned_to: "{{ctx.assigned_to}}",
          due_offset: "+14d",
          relation_kind: "follows",
        },
      },
    ],
    dedupe_window_minutes: 1440,
    max_runs_per_minute: 60,
    max_runs_per_entity: 1,
    allow_self_retrigger: false,
    description_internal: null,
  },
  {
    id: "manufacturing.capa",
    industry: "Manufacturing",
    name: "Manufacturing — CAPA on high-severity risk",
    summary: "When a high/critical risk event is logged, open a CAPA work item and notify the quality role.",
    why: "Guarantees every serious deviation creates a tracked corrective action — no risk goes unaddressed.",
    trigger_kind: "risk.created",
    type_key_hint: null,
    condition_expr: { all: [{ field: "severity", op: "in", value: ["high", "critical"] }] },
    actions: [
      {
        kind: "create_work_item",
        params: {
          type_key: "capa",
          task_name: "CAPA — {{ctx.title}}",
          description: "Auto-generated from risk event {{ctx.id}}.",
          priority: "High",
          due_offset: "+7d",
        },
      },
      {
        kind: "notify_role",
        params: {
          role_key: "quality",
          title: "New CAPA opened",
          body: "Severity {{ctx.severity}} risk triggered a CAPA. Review within 24h.",
        },
      },
    ],
    dedupe_window_minutes: 60,
    max_runs_per_minute: 30,
    max_runs_per_entity: 1,
    allow_self_retrigger: false,
    description_internal: null,
  },
  {
    id: "it.blocked-3-days",
    industry: "IT",
    name: "IT — Notify manager when task blocked > 3 days",
    summary: "When a task has been in a Blocked status past its due date, notify the manager role.",
    why: "Surfaces stalled work before it slips a sprint — manager sees the blocker without polling the board.",
    trigger_kind: "due.missed",
    type_key_hint: "task",
    condition_expr: { all: [{ field: "status", op: "eq", value: "Blocked" }] },
    actions: [
      {
        kind: "notify_role",
        params: {
          role_key: "manager",
          title: "Blocked task overdue",
          body: "{{ctx.task_name}} has been blocked past its due date. Please unblock or reassign.",
        },
      },
    ],
    dedupe_window_minutes: 1440, // notify at most once per day
    max_runs_per_minute: 30,
    max_runs_per_entity: null,
    allow_self_retrigger: false,
    description_internal: null,
  },
  {
    id: "consulting.billing-on-approval",
    industry: "Consulting",
    name: "Consulting — Create billing request when deliverable approved",
    summary: "When a deliverable's approval completes, create a billing request work item for finance.",
    why: "Closes the loop between deliverable sign-off and invoicing — no more deliverables sitting unbilled.",
    trigger_kind: "approval.completed",
    type_key_hint: "deliverable",
    condition_expr: {},
    actions: [
      {
        kind: "create_followup_work_item",
        params: {
          type_key: "billing_request",
          task_name: "Bill: {{ctx.task_name}}",
          priority: "Medium",
          due_offset: "+3d",
          relation_kind: "follows",
        },
      },
      {
        kind: "notify_role",
        params: {
          role_key: "finance",
          title: "Deliverable approved — ready to bill",
          body: "{{ctx.task_name}} was approved. Billing request created.",
        },
      },
    ],
    dedupe_window_minutes: 60,
    max_runs_per_minute: 60,
    max_runs_per_entity: 1,
    allow_self_retrigger: false,
    description_internal: null,
  },
];

export function getTemplate(id: string): RuleTemplate | undefined {
  return RULE_TEMPLATES.find((t) => t.id === id);
}

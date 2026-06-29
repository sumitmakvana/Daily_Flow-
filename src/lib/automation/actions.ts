/**
 * Action schemas and types for the automation engine.
 * Each action declares params via Zod; the worker validates before executing.
 */
import { z } from "zod";

export const ACTION_KINDS = [
  "notify_user",
  "notify_role",
  "assign_user",
  "assign_role",
  "create_work_item",
  "create_followup_work_item",
  "create_approval",
  "change_status",
  "update_field",
  "escalate",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

// Templated strings allowed via {{ctx.x}}; validated after render.
const tStr = z.string().min(1);
const tStrOpt = z.string().optional();

export const actionSchemas = {
  notify_user: z.object({
    user_id: tStr,
    title: tStr,
    body: tStrOpt,
  }),
  notify_role: z.object({
    role_key: tStr,
    title: tStr,
    body: tStrOpt,
  }),
  assign_user: z.object({
    user_id: tStr,
  }),
  assign_role: z.object({
    role_key: tStr,
  }),
  create_work_item: z.object({
    type_key: tStr,
    task_name: tStr,
    description: tStrOpt,
    priority: z.enum(["Low", "Medium", "High"]).optional(),
    assigned_to: tStrOpt,
    due_offset: tStrOpt, // e.g. "+30d"
    custom_fields: z.record(z.unknown()).optional(),
  }),
  create_followup_work_item: z.object({
    type_key: tStr,
    task_name: tStrOpt, // default = source.task_name + " — follow-up"
    priority: z.enum(["Low", "Medium", "High"]).optional(),
    assigned_to: tStrOpt,
    due_offset: tStr,
    custom_fields: z.record(z.unknown()).optional(),
    relation_kind: z.string().default("follows"),
  }),
  create_approval: z.object({
    chain_id: tStr,
  }),
  change_status: z.object({
    status_key: tStr,
  }),
  update_field: z.object({
    field_key: tStr,
    value: z.unknown(),
  }),
  escalate: z.object({
    severity: z.enum(["low", "medium", "high", "critical"]).default("high"),
    summary: tStrOpt,
  }),
} as const;

export type Action =
  | { kind: "notify_user"; params: z.infer<typeof actionSchemas.notify_user> }
  | { kind: "notify_role"; params: z.infer<typeof actionSchemas.notify_role> }
  | { kind: "assign_user"; params: z.infer<typeof actionSchemas.assign_user> }
  | { kind: "assign_role"; params: z.infer<typeof actionSchemas.assign_role> }
  | { kind: "create_work_item"; params: z.infer<typeof actionSchemas.create_work_item> }
  | {
      kind: "create_followup_work_item";
      params: z.infer<typeof actionSchemas.create_followup_work_item>;
    }
  | { kind: "create_approval"; params: z.infer<typeof actionSchemas.create_approval> }
  | { kind: "change_status"; params: z.infer<typeof actionSchemas.change_status> }
  | { kind: "update_field"; params: z.infer<typeof actionSchemas.update_field> }
  | { kind: "escalate"; params: z.infer<typeof actionSchemas.escalate> };

export const TRIGGER_KINDS = [
  "work_item.created",
  "status.changed",
  "work_item.completed",
  "approval.completed",
  "approval.rejected",
  "due.reached",
  "due.missed",
  "risk.created",
  "comment.added",
  "eod.submitted",
] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export function actionLabel(kind: ActionKind): string {
  return {
    notify_user: "Notify user",
    notify_role: "Notify role",
    assign_user: "Assign to user",
    assign_role: "Assign to role",
    create_work_item: "Create work item",
    create_followup_work_item: "Create follow-up",
    create_approval: "Start approval",
    change_status: "Change status",
    update_field: "Update field",
    escalate: "Escalate",
  }[kind];
}

export function triggerLabel(kind: TriggerKind): string {
  return {
    "work_item.created": "Work item created",
    "status.changed": "Status changed",
    "work_item.completed": "Work item completed",
    "approval.completed": "Approval completed",
    "approval.rejected": "Approval rejected",
    "due.reached": "Due date reached",
    "due.missed": "Due date missed",
    "risk.created": "Risk created",
    "comment.added": "Comment added",
    "eod.submitted": "EOD submitted",
  }[kind];
}

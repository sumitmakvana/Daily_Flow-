/**
 * Save-time validators for automation rules.
 * Implements mitigations M1, M9, M10 from PHASE_D_AUTOMATION_DESIGN.md v2.
 */
import { actionSchemas, type Action, type ActionKind, type TriggerKind } from "./actions";

export type ValidationIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
};

const SELF_RETRIGGER_ACTIONS: ActionKind[] = [
  "change_status",
  "update_field",
  "assign_user",
  "assign_role",
];
const SELF_RETRIGGER_TRIGGERS: TriggerKind[] = [
  "work_item.created",
  "status.changed",
  "work_item.completed",
];
const NOTIFY_ACTIONS: ActionKind[] = ["notify_user", "notify_role"];

export type RuleDraft = {
  trigger_kind: TriggerKind;
  actions: Action[];
  dedupe_window_minutes: number;
  allow_self_retrigger: boolean;
  description_internal?: string | null;
};

export function validateRule(rule: RuleDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Per-action shape validation
  rule.actions.forEach((a, idx) => {
    const schema = actionSchemas[a.kind as keyof typeof actionSchemas];
    if (!schema) {
      issues.push({ level: "error", code: "action.unknown", message: `Action ${idx + 1}: unknown kind "${a.kind}"` });
      return;
    }
    const r = schema.safeParse(a.params);
    if (!r.success) {
      const first = r.error.errors[0];
      issues.push({
        level: "error",
        code: "action.invalid",
        message: `Action ${idx + 1} (${a.kind}): ${first.path.join(".") || "params"} — ${first.message}`,
      });
    }
  });

  // M1: self-retrigger guard
  if (SELF_RETRIGGER_TRIGGERS.includes(rule.trigger_kind)) {
    const offenders = rule.actions.filter((a) => SELF_RETRIGGER_ACTIONS.includes(a.kind));
    if (offenders.length && !rule.allow_self_retrigger) {
      issues.push({
        level: "error",
        code: "self_retrigger",
        message: `This rule's actions (${offenders
          .map((o) => o.kind)
          .join(", ")}) can re-trigger its own "${rule.trigger_kind}" event. Enable "Allow self-retrigger" and add a rationale, or change the trigger.`,
      });
    }
  }

  // M9 + M10: notify dedupe window minimum
  const hasNotify = rule.actions.some((a) => NOTIFY_ACTIONS.includes(a.kind));
  if (hasNotify && rule.dedupe_window_minutes < 60) {
    issues.push({
      level: "error",
      code: "notify_dedupe",
      message: "Notifications require a dedupe window of at least 60 minutes to prevent spam.",
    });
  }

  // M9: dedupe=0 needs rationale
  if (rule.dedupe_window_minutes === 0 && !(rule.description_internal ?? "").trim()) {
    issues.push({
      level: "warning",
      code: "dedupe_zero",
      message: "Dedupe window of 0 fires on every event. Add an internal rationale before saving.",
    });
  }

  if (rule.actions.length === 0) {
    issues.push({ level: "error", code: "no_actions", message: "Add at least one action." });
  }
  if (rule.actions.length > 20) {
    issues.push({ level: "error", code: "too_many_actions", message: "Maximum 20 actions per rule." });
  }

  return issues;
}

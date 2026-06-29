import type { Action, TriggerKind } from "@/lib/automation/actions";
import type { GuardExpr } from "@/lib/guard";
import {
  listAutomationRulesFn,
  getAutomationRuleFn,
  createAutomationRuleFn,
  updateAutomationRuleFn,
  deleteAutomationRuleFn,
  listAutomationRunsFn,
  replayAutomationRunFn,
  automationHealthFn,
} from "./automations.functions";

export type AutomationRule = {
  id: string;
  name: string;
  description: string | null;
  description_internal: string | null;
  type_id: string | null;
  trigger_kind: TriggerKind;
  condition_expr: GuardExpr;
  actions: Action[];
  is_active: boolean;
  run_mode: "async" | "sync";
  dedupe_window_minutes: number;
  max_runs_per_entity: number | null;
  max_runs_per_minute: number;
  allow_self_retrigger: boolean;
  sort_order: number;
  auto_disabled_at: string | null;
  auto_disabled_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AutomationRun = {
  id: string;
  rule_id: string | null;
  event_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  status: string;
  attempts: number;
  actions_log: unknown;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export type AutomationHealth = {
  pending_count: number;
  pending_updated_at: string;
  runs_24h: number;
  failed_24h: number;
  dead_24h: number;
  active_rules: number;
  auto_disabled_rules: number;
};

export const automationsService = {
  async list(): Promise<AutomationRule[]> {
    return (await listAutomationRulesFn()) as AutomationRule[];
  },

  async get(id: string): Promise<AutomationRule | null> {
    return (await getAutomationRuleFn({ data: { id } })) as AutomationRule | null;
  },

  async create(input: Partial<AutomationRule>): Promise<AutomationRule> {
    return (await createAutomationRuleFn({
      data: { input: input as Record<string, unknown> },
    })) as AutomationRule;
  },

  async update(id: string, patch: Partial<AutomationRule>): Promise<void> {
    await updateAutomationRuleFn({
      data: { id, patch: patch as Record<string, unknown> },
    });
  },

  async setActive(id: string, active: boolean): Promise<void> {
    await this.update(id, {
      is_active: active,
      ...(active ? { auto_disabled_at: null, auto_disabled_reason: null } : {}),
    });
  },

  async remove(id: string): Promise<void> {
    await deleteAutomationRuleFn({ data: { id } });
  },

  async listRuns(
    filter: { ruleId?: string; status?: string; limit?: number } = {},
  ): Promise<AutomationRun[]> {
    return (await listAutomationRunsFn({ data: filter })) as AutomationRun[];
  },

  async replay(runId: string): Promise<void> {
    await replayAutomationRunFn({ data: { runId } });
  },

  async health(): Promise<AutomationHealth> {
    return (await automationHealthFn()) as AutomationHealth;
  },
};

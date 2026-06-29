
import { workItemTypesService } from "./work-item-types";
import { workflowService, type WorkItemStatus, type WorkItemTransition } from "./workflow";
import { dynamicFieldsService, type WorkItemFieldDef } from "./dynamic-fields";
import { approvalsService, type ApprovalChain, type ApprovalStep } from "./approvals";
import type { WorkItemType } from "@/lib/types";

export type HealthLevel = "ok" | "warning" | "error";
export type HealthFinding = {
  level: HealthLevel;
  code: string;
  message: string;
  hint?: string;
  panel?: "types" | "statuses" | "workflow" | "fields" | "approvals";
};
export type TypeHealth = {
  type: WorkItemType;
  status: HealthLevel;
  findings: HealthFinding[];
  counts: { statuses: number; transitions: number; fields: number; chains: number; steps: number };
};

/** Pure analyzer — given the snapshot, produce findings. Exported for unit tests. */
export function analyze(
  type: WorkItemType,
  statuses: WorkItemStatus[],
  transitions: WorkItemTransition[],
  fields: WorkItemFieldDef[],
  chains: ApprovalChain[],
  chainSteps: Record<string, ApprovalStep[]>
): TypeHealth {
  const findings: HealthFinding[] = [];

  // Status checks
  if (statuses.length === 0) {
    findings.push({ level: "error", code: "no_statuses", message: "No statuses defined", hint: "Add To Do / Done at minimum.", panel: "statuses" });
  } else {
    if (!statuses.some((s) => s.is_initial)) {
      findings.push({ level: "error", code: "no_initial", message: "No initial status — new work items can't be created", panel: "statuses" });
    }
    if (!statuses.some((s) => s.is_terminal)) {
      findings.push({ level: "warning", code: "no_terminal", message: "No terminal status — items can't be marked complete", panel: "statuses" });
    }
  }

  // Workflow checks
  if (statuses.length > 1 && transitions.length === 0) {
    findings.push({ level: "error", code: "no_transitions", message: "No workflow transitions defined", hint: "Open Workflow tab and tick allowed status changes.", panel: "workflow" });
  } else if (statuses.length > 1) {
    // Reachability BFS from initial statuses
    const adj = new Map<string, Set<string>>();
    for (const t of transitions) {
      const fromIds = t.from_status_id === null ? statuses.map((s) => s.id) : [t.from_status_id];
      for (const f of fromIds) {
        if (!adj.has(f)) adj.set(f, new Set());
        adj.get(f)!.add(t.to_status_id);
      }
    }
    const seen = new Set<string>();
    const queue: string[] = statuses.filter((s) => s.is_initial).map((s) => s.id);
    queue.forEach((id) => seen.add(id));
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    const unreachable = statuses.filter((s) => !seen.has(s.id));
    if (unreachable.length) {
      findings.push({
        level: "warning",
        code: "unreachable_status",
        message: `Status${unreachable.length > 1 ? "es" : ""} unreachable: ${unreachable.map((s) => s.label).join(", ")}`,
        hint: "Add a transition that leads to these statuses.",
        panel: "workflow",
      });
    }
  }

  // Approval chains
  for (const c of chains) {
    const steps = chainSteps[c.id] ?? [];
    if (steps.length === 0) {
      findings.push({ level: "error", code: "empty_chain", message: `Approval chain "${c.name}" has no steps`, panel: "approvals" });
    } else {
      const bad = steps.find((s) => s.approver_mode === "user" && !s.approver_user_id);
      if (bad) findings.push({ level: "error", code: "missing_approver", message: `Step "${bad.name}" has no approver assigned`, panel: "approvals" });
    }
  }

  // Field usage hint
  if (fields.length === 0) {
    findings.push({ level: "warning", code: "no_fields", message: "No form fields — only built-in fields will appear when creating items", panel: "fields" });
  }

  const status: HealthLevel = findings.some((f) => f.level === "error")
    ? "error"
    : findings.some((f) => f.level === "warning")
    ? "warning"
    : "ok";

  return {
    type,
    status,
    findings,
    counts: {
      statuses: statuses.length,
      transitions: transitions.length,
      fields: fields.length,
      chains: chains.length,
      steps: Object.values(chainSteps).reduce((acc, s) => acc + s.length, 0),
    },
  };
}

export const configHealthService = {
  async forType(type: WorkItemType): Promise<TypeHealth> {
    const [statuses, transitions, fields, chains] = await Promise.all([
      workflowService.listStatuses(type.id),
      workflowService.listTransitions(type.id),
      dynamicFieldsService.listDefs(type.id),
      approvalsService.listChainsForType(type.id),
    ]);
    const stepEntries = await Promise.all(
      chains.map(async (c) => [c.id, await approvalsService.listSteps(c.id)] as const)
    );
    return analyze(type, statuses, transitions, fields, chains, Object.fromEntries(stepEntries));
  },

  async forAllTypes(): Promise<TypeHealth[]> {
    const types = await workItemTypesService.list(true);
    return Promise.all(types.map((t) => this.forType(t)));
  },
};


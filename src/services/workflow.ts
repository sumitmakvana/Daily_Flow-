import { evalGuard, type GuardExpr } from "@/lib/guard";
import {
  listStatusesFn,
  listTransitionsFn,
} from "./workflow.functions";

export type WorkItemStatus = {
  id: string;
  type_id: string;
  key: string;
  label: string;
  category: "todo" | "in_progress" | "done" | "cancelled";
  color: string | null;
  sort_order: number;
  is_initial: boolean;
  is_terminal: boolean;
};

export type WorkItemTransition = {
  id: string;
  type_id: string;
  from_status_id: string | null;
  to_status_id: string;
  label: string | null;
  required_role: "admin" | "manager" | "member" | null;
  required_role_key: string | null;
  guard_expr: GuardExpr;
  sort_order: number;
};

export const workflowService = {
  async listStatuses(typeId: string): Promise<WorkItemStatus[]> {
    return (await listStatusesFn({ data: { typeId } })) as WorkItemStatus[];
  },

  async listTransitions(typeId: string): Promise<WorkItemTransition[]> {
    return (await listTransitionsFn({ data: { typeId } })) as WorkItemTransition[];
  },

  async allowedNextStatuses(
    typeId: string,
    currentStatusId: string | null,
  ): Promise<WorkItemTransition[]> {
    const transitions = await this.listTransitions(typeId);
    return transitions.filter(
      (t) => t.from_status_id === null || t.from_status_id === currentStatusId,
    );
  },

  availableTransitions(
    transitions: WorkItemTransition[],
    task: { status_id?: string | null; custom_fields?: Record<string, unknown> | null; [k: string]: unknown },
    userRoleKeys: string[],
  ): WorkItemTransition[] {
    const current = task.status_id ?? null;
    return transitions.filter((t) => {
      if (t.from_status_id !== null && t.from_status_id !== current) return false;
      if (t.required_role_key && !userRoleKeys.includes(t.required_role_key)) return false;
      if (!evalGuard(t.guard_expr, task)) return false;
      return true;
    });
  },
};

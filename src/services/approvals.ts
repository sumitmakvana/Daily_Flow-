import {
  listChainsForTypeFn,
  listApprovalStepsFn,
  startApprovalRequestFn,
  decideApprovalFn,
  listApprovalsForWorkItemFn,
} from "./approvals.functions";

export type ApprovalChain = {
  id: string;
  type_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  version: number;
};

export type ApprovalStep = {
  id: string;
  chain_id: string;
  step_order: number;
  name: string;
  approver_mode: "role" | "user" | "reviewer_field";
  approver_role: "admin" | "manager" | "member" | null;
  approver_role_key: string | null;
  approver_user_id: string | null;
  required_count: number;
  allow_self: boolean;
};

export type ApprovalRequest = {
  id: string;
  work_item_id: string;
  chain_id: string;
  current_step: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requested_by: string | null;
  requested_at: string;
  completed_at: string | null;
};

export type ApprovalDecision = {
  id: string;
  request_id: string;
  step_order: number;
  approver_id: string;
  decision: "approve" | "reject" | "delegate";
  comment: string | null;
  decided_at: string;
};

export const approvalsService = {
  async listChainsForType(typeId: string): Promise<ApprovalChain[]> {
    return (await listChainsForTypeFn({ data: { typeId } })) as ApprovalChain[];
  },

  async listSteps(chainId: string): Promise<ApprovalStep[]> {
    return (await listApprovalStepsFn({ data: { chainId } })) as ApprovalStep[];
  },

  async startRequest(
    workItemId: string,
    chainId: string,
  ): Promise<ApprovalRequest> {
    return (await startApprovalRequestFn({
      data: { workItemId, chainId },
    })) as ApprovalRequest;
  },

  async decide(
    requestId: string,
    stepOrder: number,
    decision: "approve" | "reject" | "delegate",
    comment?: string,
  ): Promise<ApprovalDecision> {
    return (await decideApprovalFn({
      data: { requestId, stepOrder, decision, comment },
    })) as ApprovalDecision;
  },

  async listForWorkItem(workItemId: string): Promise<ApprovalRequest[]> {
    return (await listApprovalsForWorkItemFn({
      data: { workItemId },
    })) as ApprovalRequest[];
  },
};

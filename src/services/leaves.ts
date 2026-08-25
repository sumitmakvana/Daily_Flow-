import {
  fetchLeavesFn,
  createLeaveFn,
  updateLeaveStatusFn,
  deleteLeaveFn,
} from "./leaves.functions";
import type { Leave } from "@/lib/types";

export const leavesService = {
  async getLeaves(params?: { startDate?: string; endDate?: string; status?: string; userId?: string }): Promise<Leave[]> {
    return (await fetchLeavesFn({ data: params })) as Leave[];
  },

  async applyLeave(data: {
    userId?: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    daysCount?: number;
    reason?: string;
    requestTo?: string | null;
    status?: string;
    handoverNote?: string;
  }): Promise<Leave> {
    return (await createLeaveFn({ data })) as Leave;
  },

  async updateStatus(id: string, status: "approved" | "rejected" | "cancelled" | "pending"): Promise<Leave> {
    return (await updateLeaveStatusFn({ data: { id, status } })) as Leave;
  },

  async deleteLeave(id: string, reason?: string): Promise<{ success: boolean }> {
    return await deleteLeaveFn({ data: { id, reason } });
  },
};



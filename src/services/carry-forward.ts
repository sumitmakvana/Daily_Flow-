import type { CarryForwardEvent, Task } from "@/lib/types";
import { nextWorkingDay, todayISO } from "@/lib/format";
import {
  carryTaskForwardFn,
  listOverdueForUserFn,
  listCarryEventsForTaskFn,
} from "./carry-forward.functions";

export interface CarryAllResult {
  attempted: number;
  ok: number;
  failed: number;
  errors: string[];
}

export const carryForwardService = {
  async carry(
    task: Task,
    _userId: string,
    toDate?: string,
    reason: "auto" | "eod" | "manager" = "manager",
  ) {
    const target = toDate ?? nextWorkingDay(task.due_date ?? undefined);
    await carryTaskForwardFn({
      data: {
        taskId: task.id,
        toDate: target,
        reason,
        expectedVersion: task.version,
      },
    });
  },

  async carryAllOverdue(userId: string, ownerId: string): Promise<CarryAllResult> {
    const today = todayISO();
    const tasks = (await listOverdueForUserFn({
      data: { ownerId, today },
    })) as Task[];
    let ok = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const t of tasks) {
      try {
        await this.carry(t, userId, undefined, "eod");
        ok += 1;
      } catch (e) {
        failed += 1;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${t.task_code ?? t.id}: ${msg}`);
        console.warn("[carry-forward] failed:", t.id, msg);
      }
    }
    return { attempted: tasks.length, ok, failed, errors };
  },

  async listForTask(taskId: string): Promise<CarryForwardEvent[]> {
    return (await listCarryEventsForTaskFn({
      data: { taskId },
    })) as CarryForwardEvent[];
  },
};

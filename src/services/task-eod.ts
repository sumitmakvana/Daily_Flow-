import {
  listMyEodTasksFn,
  upsertTaskEodFn,
// DISABLED: used only by TaskEodReviewCard on /dashboard (disabled). Restore together with it.
//   listEodForDateFn,
//   acknowledgeEodFn,
  type EodTaskRow,
  type ManagerEodRow,
  type EodProgressStatus,
  type TaskEodSubmission,
} from "./task-eod.functions";

export type { EodTaskRow, ManagerEodRow, EodProgressStatus, TaskEodSubmission };

export const taskEodService = {
  async myTasksToday(): Promise<EodTaskRow[]> {
    return (await listMyEodTasksFn()) as unknown as EodTaskRow[];
  },
  async submit(
    taskId: string,
    progressStatus: EodProgressStatus,
    actualHours: number,
    note: string | null,
  ): Promise<TaskEodSubmission> {
    return (await upsertTaskEodFn({
      data: { taskId, progressStatus, actualHours, note },
    })) as unknown as TaskEodSubmission;
  },
// DISABLED: used only by TaskEodReviewCard on /dashboard (disabled). Restore together with it.
//   async listForDate(date: string): Promise<ManagerEodRow[]> {
//     return (await listEodForDateFn({ data: { date } })) as unknown as ManagerEodRow[];
//   },
//   async acknowledge(id: string): Promise<void> {
//     await acknowledgeEodFn({ data: { id } });
//   },
};

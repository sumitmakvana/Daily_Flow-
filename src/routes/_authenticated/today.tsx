import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/today")({
  validateSearch: (search: Record<string, unknown>): { openCreateTask?: boolean; taskId?: string } => ({
    openCreateTask: search.openCreateTask === true || search.openCreateTask === "true" || undefined,
    taskId: typeof search.taskId === "string" ? search.taskId : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/my-day",
      search: {
        tab: "tasks",
        openCreateTask: search.openCreateTask,
        taskId: search.taskId,
      },
      replace: true,
    });
  },
  component: () => null,
});


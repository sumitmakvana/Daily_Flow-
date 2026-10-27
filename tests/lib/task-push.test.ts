import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<{ userId: string; msg: Record<string, any> }> = [];
let taskRow: Record<string, unknown> | null;
let actorName: string | null = "Priya Shah";

vi.mock("@/integrations/postgres/client.server", () => ({
  getPool: () => ({
    query: async (sql: string) => {
      if (/FROM public\.tasks t/.test(sql)) return { rows: taskRow ? [taskRow] : [] };
      if (/SELECT display_name/.test(sql)) return { rows: [{ display_name: actorName }] };
      return { rows: [] };
    },
  }),
}));
vi.mock("@/lib/fcm.server", () => ({
  isPushConfigured: () => true,
  sendPushToUser: async (userId: string, msg: Record<string, any>) => {
    sent.push({ userId, msg });
  },
}));
vi.mock("@/lib/workday-checker.server", () => ({
  checkIsWorkingDayServer: async () => ({ isWorkingDay: true }),
  getUsersOnLeaveTodayServer: async () => new Set<string>(),
}));

import { pushTaskAssigned, pushTaskProgress } from "@/lib/task-push.server";

const ASSIGNEE = "11111111-1111-4111-8111-111111111111";
const MANAGER = "44444444-4444-4444-8444-444444444444";
const TASK = "22222222-2222-4222-8222-222222222222";

const baseTask = () => ({
  id: TASK,
  task_code: "OP-12",
  task_name: "Prepare Q4 report",
  status: "To Do",
  priority: "High",
  due_date: "2026-10-17",
  assigned_to: ASSIGNEE,
  reviewer: null,
  created_by: MANAGER,
  actor_id: MANAGER,
  actor_name: "Priya Shah",
  assignee_name: "Amit Kumar",
});

describe("task push messages", () => {
  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv("PUSH_ACTION_SECRET", "test-secret");
    taskRow = baseTask();
  });

  it("assignment: titled, two-line, to the assignee, with a Start Task action", async () => {
    await pushTaskAssigned({ userId: ASSIGNEE, taskId: TASK, notificationId: "n1" });
    expect(sent).toHaveLength(1);
    const { userId, msg } = sent[0];
    expect(userId).toBe(ASSIGNEE);
    expect(msg.title).toBe("New task assigned");
    expect(msg.display).toBe(true);
    const lines = msg.body.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("[OP-12] Prepare Q4 report");
    expect(lines[1]).toContain("Assigned by Priya");
    expect(lines[1]).toContain("Due 17 Oct");
    expect(msg.data).toMatchObject({ type: "task_assigned", task_id: TASK, action: "start" });
    expect(msg.data.action_token).toBeTruthy();
  });

  it.each(["In Progress", "Completed", "Blocked", "On Hold"])(
    "assignment: no Start Task button when the task is %s",
    async (status) => {
      taskRow = { ...baseTask(), status };
      await pushTaskAssigned({ userId: ASSIGNEE, taskId: TASK });
      expect(sent[0].msg.data.action).toBeUndefined();
      expect(sent[0].msg.data.action_token).toBeUndefined();
    },
  );

  it("assignment: no Start Task button for a recipient who is not the assignee", async () => {
    await pushTaskAssigned({ userId: MANAGER, taskId: TASK });
    expect(sent[0].msg.data.action).toBeUndefined();
  });

  it("started: goes to reviewer/creator, never the person who acted", async () => {
    taskRow = { ...baseTask(), reviewer: MANAGER };
    await pushTaskProgress("started", TASK, ASSIGNEE);
    expect(sent.map((s) => s.userId)).toEqual([MANAGER]);
    expect(sent[0].msg.title).toBe("Task started");
    expect(sent[0].msg.body.split("\n")[0]).toBe("[OP-12] Prepare Q4 report");
    expect(sent[0].msg.data.action).toBeUndefined();
  });

  it("started: goes to EVERY reviewer, not just the primary one", async () => {
    const R2 = "55555555-5555-4555-8555-555555555555";
    taskRow = { ...baseTask(), reviewer: MANAGER, reviewer_ids: [MANAGER, R2] };
    await pushTaskProgress("started", TASK, ASSIGNEE);
    expect(sent.map((s) => s.userId).sort()).toEqual([MANAGER, R2].sort());
  });

  it("a person who is both reviewer and creator is notified once", async () => {
    taskRow = { ...baseTask(), reviewer: MANAGER, reviewer_ids: [MANAGER], created_by: MANAGER };
    await pushTaskProgress("started", TASK, ASSIGNEE);
    expect(sent.map((s) => s.userId)).toEqual([MANAGER]);
  });

  it("completed: notifies the assignee when someone else completes it", async () => {
    await pushTaskProgress("completed", TASK, MANAGER);
    expect(sent.map((s) => s.userId)).toEqual([ASSIGNEE]);
    expect(sent[0].msg.title).toBe("Task completed");
  });

  it("sends nothing when the actor is the only stakeholder", async () => {
    taskRow = { ...baseTask(), created_by: ASSIGNEE };
    await pushTaskProgress("started", TASK, ASSIGNEE);
    expect(sent).toHaveLength(0);
  });
});

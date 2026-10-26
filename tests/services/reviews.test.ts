import { beforeEach, describe, expect, it, vi } from "vitest";

const TASK = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

let isManager = true;
let failWith: string | null = null;
const calls: Array<{ sql: string; params: unknown[] }> = [];

const client = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    if (/public\.is_manager_or_admin/.test(sql)) return { rows: [{ ok: isManager }] };
    if (/submit_task_for_review|log_review_hours|decide_task_review/.test(sql)) {
      if (failWith) throw new Error(failWith);
      return { rows: [{ id: "rev1", task_id: TASK, cycle_no: 1 }] };
    }
    if (
      /^SELECT reviewer_id, position FROM public\.task_reviewers/.test(
        sql.replace(/\s+/g, " ").trim(),
      )
    ) {
      return { rows: [{ reviewer_id: USER, position: 1 }] };
    }
    if (/set_task_reviewers/.test(sql)) {
      if (failWith) throw new Error(failWith);
      return { rows: [{ reviewer_id: USER, position: 1 }] };
    }
    if (/FROM public\.task_reviews/.test(sql) && /ORDER BY tr\.cycle_no/.test(sql)) {
      return {
        rows: [
          { id: "rev1", cycle_no: 2 },
          { id: "rev0", cycle_no: 1 },
        ],
      };
    }
    if (/FROM public\.tasks t/.test(sql)) return { rows: [{ id: TASK, review_id: "rev1" }] };
    return { rows: [] };
  }),
};

vi.mock("@/integrations/postgres/query.server", () => ({
  withUser: async (_userId: string, fn: (c: typeof client) => Promise<unknown>) => fn(client),
}));

import { reviewsService } from "@/services/reviews";

const fnCall = (name: RegExp) => calls.find((c) => name.test(c.sql));

describe("services/reviews", () => {
  beforeEach(() => {
    calls.length = 0;
    isManager = true;
    failWith = null;
    (globalThis as unknown as { __test_user_id: string }).__test_user_id = USER;
  });

  describe("submit", () => {
    it("is a single database call: timer banking happens inside submit_task_for_review", async () => {
      const r = await reviewsService.submit({ id: TASK }, { loggedHours: 2.5, note: "  done  " });
      expect(r).toMatchObject({ id: "rev1", cycle_no: 1 });
      expect(calls).toHaveLength(1);
      // no separate read-then-bank round trips and no direct writes to tasks / worklogs
      expect(calls[0].sql).toMatch(/submit_task_for_review/);
      expect(calls.some((c) => /task_worklogs|UPDATE public\.tasks/.test(c.sql))).toBe(false);
      expect(calls[0].params).toEqual([TASK, 2.5, "done"]);
    });

    it("passes null hours when the caller does not enter any (e.g. a manager on behalf)", async () => {
      await reviewsService.submit({ id: TASK });
      expect(calls[0].params).toEqual([TASK, null, null]);
    });

    it("keeps 0 as an explicit value (confirming existing hours) rather than dropping it", async () => {
      await reviewsService.submit({ id: TASK }, { loggedHours: 0 });
      expect(calls[0].params).toEqual([TASK, 0, null]);
    });

    it("surfaces database rule violations (no reviewer, hours missing)", async () => {
      failWith = "Assign a reviewer before sending this task for review";
      await expect(reviewsService.submit({ id: TASK }, { loggedHours: 1 })).rejects.toThrow(
        /Assign a reviewer/,
      );
      failWith = "Enter the hours you worked before sending this task for review";
      await expect(reviewsService.submit({ id: TASK }, { loggedHours: 0 })).rejects.toThrow(
        /Enter the hours/,
      );
    });
  });

  describe("logHours", () => {
    it("calls log_review_hours with the hours and a trimmed note", async () => {
      await reviewsService.logHours(TASK, 3, "  fixed ");
      expect(fnCall(/log_review_hours/)?.params).toEqual([TASK, 3, "fixed"]);
    });

    it("surfaces 'only the assignee' errors from the database", async () => {
      failWith = "Only the assignee can enter logged hours for this task";
      await expect(reviewsService.logHours(TASK, 3)).rejects.toThrow(/Only the assignee/);
    });
  });

  describe("decisions", () => {
    it("approve passes the decision and optional comment", async () => {
      await reviewsService.approve(TASK, "  Looks good  ");
      expect(fnCall(/decide_task_review/)?.params).toEqual([TASK, "approved", "Looks good", null]);
    });

    it("approve without a comment sends null feedback", async () => {
      await reviewsService.approve(TASK);
      expect(fnCall(/decide_task_review/)?.params).toEqual([TASK, "approved", null, null]);
    });

    it("request changes sends the trimmed feedback", async () => {
      await reviewsService.requestChanges(TASK, "  Add tests ");
      expect(fnCall(/decide_task_review/)?.params).toEqual([
        TASK,
        "changes_requested",
        "Add tests",
        null,
      ]);
    });

    it.each(["", "   ", "\n\t"])(
      "request changes rejects blank feedback %j before any query",
      async (fb) => {
        await expect(reviewsService.requestChanges(TASK, fb)).rejects.toThrow(
          /Feedback is required/,
        );
        expect(calls).toHaveLength(0);
      },
    );

    it("surfaces permission and missing-hours errors from the database", async () => {
      failWith = "You cannot review your own work";
      await expect(reviewsService.approve(TASK)).rejects.toThrow(/own work/);
      failWith = "Logged hours are missing: the assignee must enter or confirm them";
      await expect(reviewsService.approve(TASK)).rejects.toThrow(/Logged hours are missing/);
    });

    it("never writes hours or timers itself (approval cannot double count)", async () => {
      await reviewsService.approve(TASK);
      expect(calls).toHaveLength(1);
      expect(calls.some((c) => /system_hours|actual_hours|task_worklogs/.test(c.sql))).toBe(false);
    });
  });

  describe("per-reviewer decisions", () => {
    const R2 = "33333333-3333-4333-8333-333333333333";

    it("a reviewer deciding for themselves sends no reviewer id", async () => {
      await reviewsService.approve(TASK);
      expect(fnCall(/decide_task_review/)?.params[3]).toBeNull();
    });

    it("a manager decides on behalf of a named reviewer", async () => {
      await reviewsService.approve(TASK, "ok", R2);
      expect(fnCall(/decide_task_review/)?.params).toEqual([TASK, "approved", "ok", R2]);
      calls.length = 0;
      await reviewsService.requestChanges(TASK, "redo", R2);
      expect(fnCall(/decide_task_review/)?.params).toEqual([TASK, "changes_requested", "redo", R2]);
    });

    it("surfaces the database's per-reviewer rules", async () => {
      failWith = "This reviewer has already decided on this review";
      await expect(reviewsService.approve(TASK)).rejects.toThrow(/already decided/);
      failWith = "Choose which reviewer you are deciding for";
      await expect(reviewsService.approve(TASK)).rejects.toThrow(/Choose which reviewer/);
      failWith = "Only a manager/admin can decide on behalf of another reviewer";
      await expect(reviewsService.approve(TASK, undefined, R2)).rejects.toThrow(/on behalf/);
    });

    it("the service never decides completion itself: one database call per decision", async () => {
      await reviewsService.approve(TASK);
      expect(calls).toHaveLength(1);
    });
  });

  describe("reviewer list", () => {
    it("reads the assignment list from task_reviewers", async () => {
      await reviewsService.listReviewers(TASK);
      expect(calls[0].sql).toMatch(/FROM public\.task_reviewers/);
      expect(calls[0].params).toEqual([TASK]);
    });

    it("replaces the list through set_task_reviewers (the single write path)", async () => {
      const ids = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
      await reviewsService.setReviewers(TASK, ids);
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toMatch(/set_task_reviewers/);
      expect(calls[0].params).toEqual([TASK, ids]);
    });

    it("surfaces assignment errors (assignee as reviewer, inactive reviewer)", async () => {
      failWith = "The reviewer cannot be the assignee";
      await expect(reviewsService.setReviewers(TASK, [USER])).rejects.toThrow(/assignee/);
    });
  });

  describe("reads", () => {
    it("lists a task's cycles newest first, each with its per-reviewer decisions", async () => {
      const rows = await reviewsService.listForTask(TASK);
      expect(rows.map((r) => r.cycle_no)).toEqual([2, 1]);
      expect(calls[0].sql).toMatch(/logged_hours_confirmed_at/);
      expect(calls[0].sql).toMatch(/system_hours_total/);
      expect(calls[0].sql).toMatch(/FROM public\.task_review_decisions/);
      expect(calls[0].sql).toMatch(/AS reviewers/);
    });

    it("'mine' matches every task where the caller is ONE of the reviewers", async () => {
      isManager = false;
      await reviewsService.queue("mine");
      const q = calls.find((c) => /FROM public\.tasks t/.test(c.sql));
      expect(q?.sql).toMatch(
        /task_review_decisions d\s+WHERE d\.review_id = tr\.id AND d\.reviewer_id = \$1/,
      );
      expect(q?.sql).toMatch(/pending_review_assignments/);
      expect(q?.sql).toMatch(/AS my_decision/);
      // not the legacy single-reviewer column
      expect(q?.sql).not.toMatch(/t\.reviewer = \$1/);
    });

    it("'mine' does not need manager rights and filters by reviewer", async () => {
      isManager = false;
      const rows = await reviewsService.queue("mine");
      expect(rows).toHaveLength(1);
      expect(calls.some((c) => /is_manager_or_admin/.test(c.sql))).toBe(false);
      const q = calls.find((c) => /FROM public\.tasks t/.test(c.sql));
      expect(q?.params).toEqual([USER, false]);
    });

    it("the queue carries logged and tracked hours for the reviewer", async () => {
      await reviewsService.queue("mine");
      const q = calls.find((c) => /FROM public\.tasks t/.test(c.sql));
      expect(q?.sql).toMatch(/t\.actual_hours/);
      expect(q?.sql).toMatch(/t\.system_hours/);
    });

    it("'all' is rejected for non-managers", async () => {
      isManager = false;
      await expect(reviewsService.queue("all")).rejects.toThrow(/managers and admins/);
      expect(calls.some((c) => /FROM public\.tasks t/.test(c.sql))).toBe(false);
    });

    it("'all' returns every task in review for managers", async () => {
      const rows = await reviewsService.queue("all");
      expect(rows).toHaveLength(1);
      const q = calls.find((c) => /FROM public\.tasks t/.test(c.sql));
      expect(q?.params).toEqual([USER, true]);
    });
  });
});

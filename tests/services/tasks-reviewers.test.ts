import { beforeEach, describe, expect, it, vi } from "vitest";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TASK = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

let currentReviewers: string[] = [];
const calls: Array<{ sql: string; params: unknown[] }> = [];

const client = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    calls.push({ sql: s, params });
    if (/^INSERT INTO public\.tasks/.test(s)) {
      return { rows: [{ id: TASK, task_name: "x", assigned_to: USER }] };
    }
    if (/^UPDATE public\.tasks SET/.test(s)) return { rows: [{ id: TASK, version: 2 }] };
    if (/^SELECT reviewer_id FROM public\.task_reviewers/.test(s)) {
      return { rows: currentReviewers.map((reviewer_id) => ({ reviewer_id })) };
    }
    return { rows: [] };
  }),
};

vi.mock("@/integrations/postgres/query.server", () => ({
  withUser: async (_u: string, fn: (c: typeof client) => Promise<unknown>) => fn(client),
}));
vi.mock("@/lib/task-push.server", () => ({ pushTaskProgress: vi.fn() }));
vi.mock("@/lib/task-timer.server", () => ({
  bankTimer: vi.fn(async () => 0),
  pauseOtherRunningTimers: vi.fn(async () => []),
}));

import { createTaskFn, updateTaskFn } from "@/services/tasks.functions";

const insertColumns = () => {
  const ins = calls.find((c) => /^INSERT INTO public\.tasks/.test(c.sql));
  const cols = ins?.sql.match(/\(([^)]*)\) VALUES/)?.[1] ?? "";
  return cols.split(",").map((c) => c.replace(/"/g, "").trim());
};
const insertValue = (col: string) => {
  const ins = calls.find((c) => /^INSERT INTO public\.tasks/.test(c.sql));
  return ins?.params[insertColumns().indexOf(col)];
};
const setReviewersCall = () => calls.find((c) => /set_task_reviewers/.test(c.sql));
const updateSql = () => calls.find((c) => /^UPDATE public\.tasks SET/.test(c.sql));

describe("task create/update with a reviewers list", () => {
  beforeEach(() => {
    calls.length = 0;
    currentReviewers = [];
    (globalThis as unknown as { __test_user_id: string }).__test_user_id = USER;
  });

  describe("create", () => {
    it("never writes `reviewers` as a column; the primary goes into the mirror column", async () => {
      currentReviewers = [A]; // what the insert trigger registered
      await createTaskFn({ data: { payload: { task_name: "x", reviewers: [A, B] } } } as never);
      expect(insertColumns()).not.toContain("reviewers");
      expect(insertValue("reviewer")).toBe(A);
    });

    it("sets the complete list through set_task_reviewers when there is more than one", async () => {
      currentReviewers = [A];
      await createTaskFn({ data: { payload: { task_name: "x", reviewers: [A, B, C] } } } as never);
      expect(setReviewersCall()?.params).toEqual([TASK, [A, B, C]]);
    });

    it("a single reviewer needs no extra call (the insert trigger registers it)", async () => {
      await createTaskFn({ data: { payload: { task_name: "x", reviewers: [A] } } } as never);
      expect(insertValue("reviewer")).toBe(A);
      expect(setReviewersCall()).toBeUndefined();
    });

    it("an empty list means no reviewer", async () => {
      await createTaskFn({
        data: { payload: { task_name: "x", reviewers: [], reviewer: A } },
      } as never);
      expect(insertColumns()).not.toContain("reviewer");
      expect(setReviewersCall()).toBeUndefined();
    });

    it("drops duplicates and anything that is not a uuid", async () => {
      currentReviewers = [A];
      await createTaskFn({
        data: { payload: { task_name: "x", reviewers: [A, A, "not-a-uuid", B, 42, null] } },
      } as never);
      expect(setReviewersCall()?.params).toEqual([TASK, [A, B]]);
    });

    it("older callers (CSV import) that only send `reviewer` are left to the database sync", async () => {
      await createTaskFn({ data: { payload: { task_name: "x", reviewer: A } } } as never);
      expect(insertValue("reviewer")).toBe(A);
      expect(setReviewersCall()).toBeUndefined();
    });
  });

  describe("update", () => {
    const update = (patch: Record<string, unknown>) =>
      updateTaskFn({ data: { id: TASK, version: 1, patch } } as never);

    it("strips `reviewers` and the legacy `reviewer` from the UPDATE", async () => {
      currentReviewers = [A];
      await update({ task_name: "renamed", reviewer: A, reviewers: [A, B] });
      const sql = updateSql()?.sql ?? "";
      expect(sql).toMatch(/"task_name" = /);
      expect(sql).not.toMatch(/"reviewer/);
    });

    it("applies the list through set_task_reviewers when it changed", async () => {
      currentReviewers = [A];
      await update({ task_name: "renamed", reviewers: [A, B] });
      expect(setReviewersCall()?.params).toEqual([TASK, [A, B]]);
    });

    it("an unchanged list makes no call (so a locked task can still be edited)", async () => {
      currentReviewers = [A, B];
      await update({ task_name: "renamed", reviewers: [A, B] });
      expect(setReviewersCall()).toBeUndefined();
    });

    it("a different order counts as a change because the first reviewer is the primary", async () => {
      currentReviewers = [A, B];
      await update({ task_name: "renamed", reviewers: [B, A] });
      expect(setReviewersCall()?.params).toEqual([TASK, [B, A]]);
    });

    it("clearing the list removes every reviewer", async () => {
      currentReviewers = [A, B];
      await update({ task_name: "renamed", reviewers: [] });
      expect(setReviewersCall()?.params).toEqual([TASK, []]);
    });

    it("a patch without `reviewers` never touches the reviewer tables", async () => {
      await update({ task_name: "renamed" });
      expect(calls.some((c) => /task_reviewers|set_task_reviewers/.test(c.sql))).toBe(false);
    });
  });
});

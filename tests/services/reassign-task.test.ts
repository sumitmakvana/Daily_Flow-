// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Static guards for the secure task-reassignment change (the database side is exercised against a real
// Postgres by the local RLS test scripts; see docs/proposals/rls-role-scoping-v2.sql).
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
const fn = read("src/services/tasks.functions.ts");
const sql = read("docs/proposals/rls-role-scoping-v2.sql");

describe("updateTaskFn reassignment", () => {
  it("sends a change of assignee through reassign_task() instead of a plain UPDATE", () => {
    expect(fn).toContain("SELECT * FROM public.reassign_task($1, $2)");
    expect(fn).toMatch(/if \(reassigning\) delete patch\.assigned_to;/);
  });

  it("writes the other fields first (while the caller can still see the task) and reassigns last", () => {
    const update = fn.indexOf("UPDATE public.tasks SET");
    const reassign = fn.indexOf("reassign_task($1, $2)");
    expect(update).toBeGreaterThan(-1);
    expect(reassign).toBeGreaterThan(update);
  });

  it("keeps the old behaviour in test mode (no function call)", () => {
    expect(fn).toMatch(/import\.meta\.env\.MODE !== "test" &&\s*"assigned_to" in patch/);
  });
});

describe("rls-role-scoping-v2.sql", () => {
  const fnBody = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.reassign_task"), sql.indexOf("REVOKE ALL ON FUNCTION public.reassign_task"));

  it("does not broaden visibility with updated_by", () => {
    const policies = sql.slice(sql.indexOf("-- 3) Policies"));
    expect(policies).not.toMatch(/updated_by\s*=/);
  });

  it("the reassign function checks the caller and changes only assigned_to and updated_by", () => {
    expect(fnBody).toContain("public.req_uid()");
    expect(fnBody).toMatch(/Not authenticated/);
    expect(fnBody).toMatch(/assigned_to = uid OR t\.created_by = uid OR public\.is_manager_or_admin\(uid\)/);
    const setClause = /UPDATE public\.tasks\s+SET([\s\S]*?)WHERE/.exec(fnBody)?.[1] ?? "";
    const assigned = setClause.split(",").map((s) => s.split("=")[0].trim()).filter(Boolean);
    expect(assigned).toEqual(["assigned_to", "updated_by"]);
  });

  it("repeats the In Review rule inside the function (triggers skip their checks when auth.uid() is NULL over REST)", () => {
    expect(fnBody).toMatch(/status = 'In Review' AND NOT public\.is_manager_or_admin\(uid\)/);
  });

  it("is not executable by anon/public, and is SECURITY DEFINER with a fixed search_path", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.reassign_task\(uuid, uuid\) FROM PUBLIC;/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.reassign_task\(uuid, uuid\) FROM anon;/);
    expect(fnBody).toMatch(/SECURITY DEFINER SET search_path = public, pg_temp/);
  });

  it("scopes every table with the same rule (and the review tables), and never touches existing auth.uid()", () => {
    for (const t of ["tasks_read_scoped", "worklogs_read_scoped", "comments_read_scoped", "attach_read_scoped", "history_read_scoped", "cfe_read_scoped", "task_reviewers_read_scoped", "task_reviews_read_scoped", "task_review_decisions_read_scoped", "risk_read_scoped"]) {
      expect(sql).toContain(t);
    }
    // every new policy/function uses req_uid(); auth.uid() only appears inside req_uid() itself and in comments
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const outside = code.replace(/CREATE OR REPLACE FUNCTION public\.req_uid\(\)[\s\S]*?\$fn\$;/, "");
    expect(outside).not.toContain("auth.uid()");
  });
});

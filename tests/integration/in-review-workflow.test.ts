/**
 * Integration test: In Review workflow SQL (submit_task_for_review, decide_task_review,
 * transition/field guard, task_reviews RLS). Runs tests/integration/in-review-workflow.sql,
 * which asserts every rule inside a rolled-back transaction as the `authenticated` role.
 *
 * It creates users and tasks and consumes sequence values, so it must NEVER point at a real
 * database. It only runs when ALL of these hold, otherwise it is skipped:
 *   - PGHOST is set (psql connection),
 *   - OPERON_ALLOW_DB_TESTS=1 (explicit opt-in),
 *   - PGDATABASE is set and contains "test".
 * The SQL script re-checks the database name and refuses to run without its own session flag.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

export function dbTestsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.PGHOST && env.OPERON_ALLOW_DB_TESTS === "1" && /test/i.test(env.PGDATABASE ?? "");
}

const d = dbTestsEnabled() ? describe : describe.skip;

describe("in-review integration opt-in", () => {
  it("needs PGHOST, OPERON_ALLOW_DB_TESTS=1 and a *test* database name", () => {
    expect(
      dbTestsEnabled({ PGHOST: "h", OPERON_ALLOW_DB_TESTS: "1", PGDATABASE: "operon_test" }),
    ).toBe(true);
    expect(dbTestsEnabled({ PGHOST: "h", PGDATABASE: "operon_test" })).toBe(false);
    expect(dbTestsEnabled({ PGHOST: "h", OPERON_ALLOW_DB_TESTS: "1", PGDATABASE: "operon" })).toBe(
      false,
    );
    expect(dbTestsEnabled({ PGHOST: "h", OPERON_ALLOW_DB_TESTS: "1" })).toBe(false);
    expect(dbTestsEnabled({ OPERON_ALLOW_DB_TESTS: "1", PGDATABASE: "operon_test" })).toBe(false);
  });
});

d("integration/in-review workflow", () => {
  it("enforces permissions, self-approval, feedback, locks, history and notifications", () => {
    const script = path.resolve(__dirname, "in-review-workflow.sql");
    const out = execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PGOPTIONS: `${process.env.PGOPTIONS ?? ""} -c app.allow_db_tests=yes`.trim(),
      },
    });
    expect(out).toContain("IN_REVIEW_WORKFLOW_OK");
  });
});

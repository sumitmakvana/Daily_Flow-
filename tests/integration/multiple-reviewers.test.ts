/**
 * Integration test: multiple reviewers (task_reviewers, task_review_decisions,
 * set_task_reviewers, decide_task_review, the tasks.reviewer mirror triggers).
 * Runs tests/integration/multiple-reviewers.sql, which asserts every rule inside a rolled-back
 * transaction as the `authenticated` role.
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

const enabled =
  !!process.env.PGHOST &&
  process.env.OPERON_ALLOW_DB_TESTS === "1" &&
  /test/i.test(process.env.PGDATABASE ?? "");

const d = enabled ? describe : describe.skip;

d("integration/multiple reviewers", () => {
  it("keeps each reviewer's status independent and completes only when all have approved", () => {
    const script = path.resolve(__dirname, "multiple-reviewers.sql");
    const out = execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PGOPTIONS: `${process.env.PGOPTIONS ?? ""} -c app.allow_db_tests=yes`.trim(),
      },
    });
    expect(out).toContain("MULTIPLE_REVIEWERS_OK");
  });
});

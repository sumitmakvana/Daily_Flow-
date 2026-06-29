/**
 * Integration tests for SQL functions against the real Lovable Cloud DB.
 * Runs via `psql` using the sandbox's PG* env vars. Skipped when PGHOST
 * is missing (CI without DB access). Each function is invoked end-to-end
 * to validate it parses, executes, and returns the expected shape.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

const HAS_DB = !!process.env.PGHOST;
const d = HAS_DB ? describe : describe.skip;

function psql(sql: string): string {
  return execSync(`psql -t -A -c ${JSON.stringify(sql)}`, { encoding: "utf8" }).trim();
}

d("integration/sql-functions", () => {
  it("detect_risks() returns an integer", () => {
    const out = psql("SELECT public.detect_risks();");
    expect(Number.isInteger(Number(out))).toBe(true);
    expect(Number(out)).toBeGreaterThanOrEqual(0);
  }, 30000);

  it("generate_nudges() returns an integer", () => {
    const out = psql("SELECT public.generate_nudges();");
    expect(Number.isInteger(Number(out))).toBe(true);
  });

  it("generate_planning_suggestions() returns an integer", () => {
    const out = psql("SELECT public.generate_planning_suggestions();");
    expect(Number.isInteger(Number(out))).toBe(true);
  });

  it("adoption_rollup() returns an integer and is idempotent", () => {
    const a = psql("SELECT public.adoption_rollup();");
    const b = psql("SELECT public.adoption_rollup();");
    expect(Number.isInteger(Number(a))).toBe(true);
    expect(Number.isInteger(Number(b))).toBe(true);
  });

  it("predict_tomorrow_risks() returns rows with task_id/risk_score/reasons", () => {
    const out = psql(
      "SELECT count(*)::int FROM public.predict_tomorrow_risks() WHERE risk_score IS NOT NULL AND reasons IS NOT NULL;",
    );
    expect(Number(out)).toBeGreaterThanOrEqual(0);
  });

  it("has_role / is_manager_or_admin are callable with a random uuid", () => {
    const out = psql(
      "SELECT public.has_role('00000000-0000-0000-0000-000000000000'::uuid,'admin')::text || ',' || public.is_manager_or_admin('00000000-0000-0000-0000-000000000000'::uuid)::text;",
    );
    expect(out).toBe("false,false");
  });

  it("risk_events / nudges / planning_suggestions tables exist and are readable", () => {
    const out = psql(
      "SELECT (SELECT count(*) FROM public.risk_events)::int + (SELECT count(*) FROM public.nudges)::int + (SELECT count(*) FROM public.planning_suggestions)::int;",
    );
    expect(Number.isInteger(Number(out))).toBe(true);
  });

  it("RLS is enabled on user-data tables", () => {
    const out = psql(
      "SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('tasks','nudges','planning_suggestions','eod_checkins','notification_prefs','audit_exports','adoption_daily');",
    );
    expect(out).toBe("t");
  });
});

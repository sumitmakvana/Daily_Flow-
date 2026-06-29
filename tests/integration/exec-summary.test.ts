/**
 * Smoke test for the Executive Dashboard rollup function.
 *
 * Asserts:
 *   1. exec_summary() executes (no parse/runtime error) for an admin session
 *   2. Returns valid JSON
 *   3. Contains every top-level key the UI consumes
 *   4. Anonymous callers are denied (42501) — defense-in-depth gate intact
 *   5. EXECUTE on exec_summary / manager_visible_team_ids is restricted to
 *      authenticated + service_role; PUBLIC and anon must NOT appear
 *
 * Skipped when PGHOST is not available (CI without DB access).
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

const HAS_DB = !!process.env.PGHOST;
const d = HAS_DB ? describe : describe.skip;

function psql(sql: string): string {
  return execSync(`psql -t -A -c ${JSON.stringify(sql)}`, { encoding: "utf8" }).trim();
}
function psqlExpectError(sql: string): string {
  try {
    execSync(`psql -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "";
  } catch (e) {
    return ((e as { stderr?: Buffer }).stderr?.toString() ?? "") + ((e as Error).message ?? "");
  }
}

const EXPECTED_KEYS = [
  "meta",
  "execution",
  "delivery",
  "risk",
  "workload",
  "discipline",
  "automation",
  "adoption",
  "team_health",
  "manager_effectiveness",
  "insights_inputs",
  "filters",
];

d("integration/exec_summary smoke", () => {
  it("returns valid JSON with all top-level keys for an authenticated admin", () => {
    const adminId = psql(
      "SELECT user_id::text FROM public.user_roles WHERE role = 'admin' LIMIT 1;",
    );
    expect(adminId).toMatch(/^[0-9a-f-]{36}$/);

    const claims = JSON.stringify({ sub: adminId, role: "authenticated" });
    const out = execSync(`psql -t -A -q`, {
      encoding: "utf8",
      input: `SET request.jwt.claims = '${claims}'; SELECT public.exec_summary(7)::text;`,
    }).trim();

    expect(out.length).toBeGreaterThan(0);
    const parsed = JSON.parse(out);
    expect(parsed).toBeTypeOf("object");
    for (const k of EXPECTED_KEYS) {
      expect(parsed, `missing key: ${k}`).toHaveProperty(k);
    }
    expect(parsed.meta).toHaveProperty("today");
    expect(parsed.meta).toHaveProperty("is_admin", true);
    expect(Array.isArray(parsed.workload.rows)).toBe(true);
    expect(Array.isArray(parsed.filters.teams)).toBe(true);
  }, 30000);

  it("denies execution to unauthenticated callers (42501)", () => {
    const err = psqlExpectError("RESET request.jwt.claims; SELECT public.exec_summary(7);");
    expect(err).toMatch(/manager or admin required/);
  });

  it("revokes EXECUTE from PUBLIC and anon on exec_summary and manager_visible_team_ids", () => {
    const out = psql(
      "SELECT proname || ':' || COALESCE(array_to_string(proacl, ','), '') FROM pg_proc " +
        "WHERE proname IN ('exec_summary','manager_visible_team_ids') ORDER BY proname;",
    );
    // proacl contains role=privs/grantor entries. PUBLIC shows as a bare '=X/...'.
    expect(out).not.toMatch(/anon=/);
    expect(out).not.toMatch(/(^|,)=X\//m); // no bare PUBLIC EXECUTE entry
    expect(out).toMatch(/authenticated=X/);
  });
});

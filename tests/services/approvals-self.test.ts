/**
 * Integration test: is_request_approver enforces allow_self.
 * Skipped without psql access.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

const HAS_DB = !!process.env.PGHOST;
const d = HAS_DB ? describe : describe.skip;

function psql(sql: string): string {
  return execSync(`psql -t -A -c ${JSON.stringify(sql)}`, { encoding: "utf8" }).trim();
}

d("integration/approval allow_self", () => {
  it("function signature includes allow_self guard", () => {
    const out = psql(
      "SELECT pg_get_functiondef('public.is_request_approver(uuid,uuid)'::regprocedure)",
    );
    expect(out).toMatch(/allow_self\s*=\s*true\s+OR\s+r\.requested_by\s+IS\s+DISTINCT\s+FROM/i);
  });

  it("protect_system_org_roles trigger exists on org_roles", () => {
    const out = psql(
      "SELECT tgname FROM pg_trigger WHERE tgrelid='public.org_roles'::regclass AND tgname='trg_protect_system_org_roles'",
    );
    expect(out).toBe("trg_protect_system_org_roles");
  });
});

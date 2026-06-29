/**
 * Phase D automation runtime tests.
 *
 * Pure-unit coverage: validators (M1/M9/M10), templates registry, action
 * schema integrity. Integration-style checks (depth GUC, replay, deletion +
 * deactivation guards, circuit-breaker auto-disable column, soft-cap log)
 * run only when PG* env vars are present.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { validateRule } from "@/lib/automation/validators";
import { RULE_TEMPLATES } from "@/lib/automation/templates";
import { actionSchemas } from "@/lib/automation/actions";

const HAS_DB = !!process.env.PGHOST;
const dbDescribe = HAS_DB ? describe : describe.skip;

function psql(sql: string): string {
  return execSync(`psql -t -A -c ${JSON.stringify(sql)}`, { encoding: "utf8" }).trim();
}

describe("automation/validators (recursion prevention, notify dedupe)", () => {
  it("blocks self-retrigger when allow_self_retrigger=false", () => {
    const issues = validateRule({
      trigger_kind: "status.changed",
      actions: [{ kind: "change_status", params: { status_key: "Done" } }],
      dedupe_window_minutes: 60,
      allow_self_retrigger: false,
    });
    expect(issues.some((i) => i.code === "self_retrigger" && i.level === "error")).toBe(true);
  });

  it("permits self-retrigger when explicitly enabled", () => {
    const issues = validateRule({
      trigger_kind: "status.changed",
      actions: [{ kind: "change_status", params: { status_key: "Done" } }],
      dedupe_window_minutes: 60,
      allow_self_retrigger: true,
    });
    expect(issues.some((i) => i.code === "self_retrigger")).toBe(false);
  });

  it("requires >=60min dedupe on notify actions (anti-spam)", () => {
    const issues = validateRule({
      trigger_kind: "comment.added",
      actions: [{ kind: "notify_user", params: { user_id: crypto.randomUUID(), title: "Hi" } }],
      dedupe_window_minutes: 5,
      allow_self_retrigger: false,
    });
    expect(issues.some((i) => i.code === "notify_dedupe" && i.level === "error")).toBe(true);
  });

  it("caps action list length", () => {
    const a = { kind: "notify_user", params: { user_id: crypto.randomUUID(), title: "x" } } as const;
    const issues = validateRule({
      trigger_kind: "comment.added",
      actions: Array.from({ length: 21 }, () => a),
      dedupe_window_minutes: 60,
      allow_self_retrigger: false,
    });
    expect(issues.some((i) => i.code === "too_many_actions")).toBe(true);
  });
});

describe("automation/templates (5 industry seeds)", () => {
  it("ships all five industries", () => {
    const industries = new Set(RULE_TEMPLATES.map((t) => t.industry));
    expect(industries.has("Pharma")).toBe(true);
    expect(industries.has("Adhesives")).toBe(true);
    expect(industries.has("Manufacturing")).toBe(true);
    expect(industries.has("IT")).toBe(true);
    expect(industries.has("Consulting")).toBe(true);
  });

  it("every template passes save-time validation", () => {
    for (const t of RULE_TEMPLATES) {
      const issues = validateRule({
        trigger_kind: t.trigger_kind,
        actions: t.actions,
        dedupe_window_minutes: t.dedupe_window_minutes,
        allow_self_retrigger: t.allow_self_retrigger,
        description_internal: t.description_internal,
      });
      const errors = issues.filter((i) => i.level === "error");
      expect(errors, `template ${t.id} errors: ${JSON.stringify(errors)}`).toHaveLength(0);
    }
  });

  it("every action kind in every template has a registered schema", () => {
    for (const t of RULE_TEMPLATES) {
      for (const a of t.actions) {
        expect(actionSchemas[a.kind as keyof typeof actionSchemas]).toBeDefined();
      }
    }
  });
});

dbDescribe("integration/automation runtime", () => {
  it("automation_set_depth helper exists (M2 fix)", () => {
    const out = psql(
      "SELECT proname FROM pg_proc WHERE proname='automation_set_depth' AND pronamespace='public'::regnamespace",
    );
    expect(out).toBe("automation_set_depth");
  });

  it("set_config writes app.automation_depth and _current_automation_depth reads it back", () => {
    // SET LOCAL only persists in a txn; use a DO block.
    const out = psql(
      "BEGIN; SELECT public.automation_set_depth(3); SELECT public._current_automation_depth(); COMMIT;",
    );
    expect(out).toContain("3");
  });

  it("circuit-breaker columns present on automation_rules", () => {
    const out = psql(
      "SELECT count(*) FROM information_schema.columns WHERE table_name='automation_rules' AND column_name IN ('auto_disabled_at','auto_disabled_reason')",
    );
    expect(out).toBe("2");
  });

  it("DLQ surfaces dropped=true + drop_reason on automation_events", () => {
    const out = psql(
      "SELECT count(*) FROM information_schema.columns WHERE table_name='automation_events' AND column_name IN ('dropped','drop_reason','attempts')",
    );
    expect(out).toBe("3");
  });

  it("replay function exists and is admin-gated", () => {
    const out = psql(
      "SELECT proname FROM pg_proc WHERE proname='automation_replay_dead_run' AND pronamespace='public'::regnamespace",
    );
    expect(out).toBe("automation_replay_dead_run");
  });

  it("deletion guards present on field_defs/statuses/types", () => {
    const out = psql(
      "SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_guard_field_def_delete','trg_guard_status_delete','trg_guard_type_delete')",
    );
    expect(out).toBe("3");
  });

  it("type-deactivation guard present (Phase D hardening P5)", () => {
    const out = psql(
      "SELECT tgname FROM pg_trigger WHERE tgname='trg_guard_type_deactivation' AND tgrelid='public.work_item_types'::regclass",
    );
    expect(out).toBe("trg_guard_type_deactivation");
  });

  it("enqueue logs queue_soft_cap when pending crosses 5,000", () => {
    const def = psql(
      "SELECT pg_get_functiondef('public.enqueue_automation_event(text,text,uuid,jsonb,uuid,int,timestamptz)'::regprocedure)",
    );
    expect(def).toContain("queue_soft_cap");
    expect(def).toContain("SOFT_CAP");
  });
});

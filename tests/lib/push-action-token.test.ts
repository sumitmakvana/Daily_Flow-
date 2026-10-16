import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isActionSigningConfigured,
  markActionRedeemed,
  releaseAction,
  signPushAction,
  verifyPushAction,
} from "@/lib/push-action-token.server";

const USER = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";

describe("push action tokens", () => {
  beforeEach(() => {
    vi.stubEnv("PUSH_ACTION_SECRET", "test-secret");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("round-trips claims bound to user, task and action", () => {
    const token = signPushAction(USER, TASK, "start")!;
    const claims = verifyPushAction(token)!;
    expect(claims).toMatchObject({ u: USER, t: TASK, a: "start" });
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it("is disabled without a secret", () => {
    vi.stubEnv("PUSH_ACTION_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    expect(isActionSigningConfigured()).toBe(false);
    expect(signPushAction(USER, TASK, "start")).toBeNull();
  });

  it("rejects tampered payloads and signatures", () => {
    const token = signPushAction(USER, TASK, "start")!;
    const [body, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), u: "other" }),
    ).toString("base64url");
    expect(verifyPushAction(`${forged}.${sig}`)).toBeNull();
    expect(verifyPushAction(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(verifyPushAction("garbage")).toBeNull();
    expect(verifyPushAction(undefined)).toBeNull();
  });

  it("rejects tokens signed with a different secret", () => {
    const token = signPushAction(USER, TASK, "start")!;
    vi.stubEnv("PUSH_ACTION_SECRET", "another-secret");
    expect(verifyPushAction(token)).toBeNull();
  });

  it("expires", () => {
    vi.useFakeTimers();
    const token = signPushAction(USER, TASK, "start")!;
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    expect(verifyPushAction(token)).toBeNull();
  });

  it("can be redeemed only once, unless released after a failure", () => {
    const claims = verifyPushAction(signPushAction(USER, TASK, "start")!)!;
    expect(markActionRedeemed(claims)).toBe(true);
    expect(markActionRedeemed(claims)).toBe(false);
    releaseAction(claims);
    expect(markActionRedeemed(claims)).toBe(true);
  });
});

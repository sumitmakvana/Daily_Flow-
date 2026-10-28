import { beforeEach, describe, expect, it, vi } from "vitest";

// ensure_user_profile only matters for a first login. It used to run on every page load (and reload);
// it now runs once per user per browser session, and a failed call is retried on the next load.

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("keycloak-js", () => ({ default: class { init() { return Promise.resolve(false); } } }));

import { ensureProfileOnce } from "@/integrations/backend/auth";

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
  sessionStorage.clear();
});

describe("ensureProfileOnce", () => {
  it("calls ensure_user_profile with the user's details the first time only", async () => {
    await ensureProfileOnce("u1", "a@x.test", "Ann");
    await ensureProfileOnce("u1", "a@x.test", "Ann");
    await ensureProfileOnce("u1", "a@x.test", "Ann");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("ensure_user_profile", { user_id: "u1", user_email: "a@x.test", user_name: "Ann" });
  });

  it("falls back to the email's local part when there is no name", async () => {
    await ensureProfileOnce("u1", "ann@x.test", "");
    expect(rpc.mock.calls[0][1]).toMatchObject({ user_name: "ann" });
  });

  it("a failed call is not remembered, so the next load retries it", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "boom" } });
    await ensureProfileOnce("u1", "a@x.test", "Ann");
    await ensureProfileOnce("u1", "a@x.test", "Ann");
    expect(rpc).toHaveBeenCalledTimes(2);
    await ensureProfileOnce("u1", "a@x.test", "Ann");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("is per user: a different user signing in on the same tab is provisioned", async () => {
    await ensureProfileOnce("u1", "a@x.test", "Ann");
    await ensureProfileOnce("u2", "b@x.test", "Bob");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("still works when sessionStorage is unavailable", async () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(ensureProfileOnce("u1", "a@x.test", "Ann")).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_CLIENT_ID,
  WEB_CLIENT_ID,
  clearStored,
  passwordLogin,
  readStored,
  refreshTokens,
  revokeSession,
  secondsUntilExpiry,
  writeStored,
} from "@/lib/app-session";
import type { SecureTokenStore } from "@/lib/secure-token-store";

const BASE = "https://auth.example.test";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function bodyOf(call: unknown[]): URLSearchParams {
  return new URLSearchParams(((call[1] as RequestInit).body as URLSearchParams).toString());
}

function jwt(exp: number) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64({ exp })}.sig`;
}

afterEach(() => vi.unstubAllGlobals());

describe("passwordLogin", () => {
  it("uses the app client with offline_access and reports an offline session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json(200, {
          access_token: "a",
          refresh_token: "r",
          scope: "openid profile email offline_access",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const r = await passwordLogin(BASE, "u@x.in", "pw");
    const sent = bodyOf(fetchMock.mock.calls[0]);
    expect(sent.get("client_id")).toBe(APP_CLIENT_ID);
    expect(sent.get("scope")).toContain("offline_access");
    expect(r).toMatchObject({ clientId: APP_CLIENT_ID, offline: true });
  });

  it.each(["invalid_client", "invalid_scope"])(
    "falls back to the website client when Keycloak answers %s (not configured yet)",
    async (error) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json(400, { error }))
        .mockResolvedValueOnce(
          json(200, { access_token: "a", refresh_token: "r", scope: "openid" }),
        );
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const r = await passwordLogin(BASE, "u@x.in", "pw");
      expect(bodyOf(fetchMock.mock.calls[1]).get("client_id")).toBe(WEB_CLIENT_ID);
      expect(bodyOf(fetchMock.mock.calls[1]).get("scope")).not.toContain("offline_access");
      expect(r).toMatchObject({ clientId: WEB_CLIENT_ID, offline: false });
    },
  );

  it("does not fall back on bad credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json(401, { error: "invalid_grant", error_description: "Invalid user credentials" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(passwordLogin(BASE, "u@x.in", "bad")).rejects.toThrow("Invalid user credentials");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("refreshTokens", () => {
  const stored = { c: APP_CLIENT_ID, t: "refresh-1" };

  it("returns new tokens, sending the stored client and refresh token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json(200, { access_token: "a2", refresh_token: "refresh-2" }));
    vi.stubGlobal("fetch", fetchMock);
    const o = await refreshTokens(BASE, stored);
    expect(o).toMatchObject({ status: "ok", tokens: { refresh_token: "refresh-2" } });
    const sent = bodyOf(fetchMock.mock.calls[0]);
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("client_id")).toBe(APP_CLIENT_ID);
    expect(sent.get("refresh_token")).toBe("refresh-1");
  });

  it.each([400, 401])(
    "treats HTTP %s (expired/revoked) as a definitive end of session",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(status, { error: "invalid_grant" })));
      expect((await refreshTokens(BASE, stored)).status).toBe("invalid");
    },
  );

  it.each([500, 502, 503])("treats HTTP %s as transient (keep the session)", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(status, {})));
    expect((await refreshTokens(BASE, stored)).status).toBe("network");
  });

  it("treats a network failure as transient", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect((await refreshTokens(BASE, stored)).status).toBe("network");
  });
});

describe("revokeSession", () => {
  it("revokes and ends the session server-side, tolerating failures", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(json(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await expect(revokeSession(BASE, { c: APP_CLIENT_ID, t: "r" })).resolves.toBeUndefined();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith("/protocol/openid-connect/revoke"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/protocol/openid-connect/logout"))).toBe(true);
  });
});

describe("stored session", () => {
  const memory = (initial: string | null = null): SecureTokenStore & { value: string | null } => {
    const s = {
      value: initial,
      get: async () => s.value,
      set: async (v: string) => void (s.value = v),
      remove: async () => void (s.value = null),
    };
    return s;
  };

  it("round-trips and clears", async () => {
    const store = memory();
    expect(await writeStored(store, { c: "operon-app", t: "r" })).toBe(true);
    expect(await readStored(store)).toEqual({ c: "operon-app", t: "r" });
    await clearStored(store);
    expect(await readStored(store)).toBeNull();
  });

  it("ignores corrupt data instead of throwing", async () => {
    expect(await readStored(memory("not json"))).toBeNull();
    expect(await readStored(memory('{"c":1}'))).toBeNull();
  });

  it("reports a failed write without throwing", async () => {
    const broken: SecureTokenStore = {
      get: async () => null,
      set: async () => {
        throw new Error("keystore unavailable");
      },
      remove: async () => {},
    };
    expect(await writeStored(broken, { c: "c", t: "t" })).toBe(false);
  });
});

describe("secondsUntilExpiry", () => {
  it("computes remaining lifetime from the token", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(secondsUntilExpiry(jwt(now + 300))).toBeGreaterThan(290);
    expect(secondsUntilExpiry(jwt(now - 10))).toBeLessThan(0);
  });
  it("is 0 for missing or malformed tokens", () => {
    expect(secondsUntilExpiry(undefined)).toBe(0);
    expect(secondsUntilExpiry("garbage")).toBe(0);
  });
});

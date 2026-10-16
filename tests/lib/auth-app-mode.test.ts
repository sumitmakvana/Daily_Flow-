import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Persistent-session behaviour of src/integrations/backend/auth.ts in app mode
 * (secure storage available = Android / Desktop apps).
 */

const jwt = (expInSeconds: number) => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + expInSeconds;
  return `${b64({ alg: "none" })}.${b64({ exp, sub: "user-1", email: "u@x.in", name: "U" })}.sig`;
};

const tokenResponse = (refresh: string, ttl = 600) => ({
  access_token: jwt(ttl),
  refresh_token: refresh,
  scope: "openid profile email offline_access",
});

const res = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let secureValue: string | null;
const fakeStore = {
  get: vi.fn(async () => secureValue),
  set: vi.fn(async (v: string) => void (secureValue = v)),
  remove: vi.fn(async () => void (secureValue = null)),
};
let storeAvailable = true;

vi.mock("@/lib/secure-token-store", () => ({
  getSecureTokenStore: () => (storeAvailable ? fakeStore : null),
}));
vi.mock("keycloak-js", () => ({
  default: class {
    authenticated = false;
    authServerUrl = "https://auth.example.test";
    init = vi.fn(async () => false);
    updateToken = vi.fn(async () => false);
    logout = vi.fn(async () => {});
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({})) },
}));

async function loadAuth() {
  vi.resetModules();
  return await import("@/integrations/backend/auth");
}

describe("auth in app mode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    storeAvailable = true;
    secureValue = null;
    fakeStore.get.mockClear();
    fakeStore.set.mockClear();
    fakeStore.remove.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("restores the session at launch and rotates the stored refresh token, never using localStorage for it", async () => {
    secureValue = JSON.stringify({ c: "operon-app", t: "old-refresh" });
    window.localStorage.setItem("kc_refresh_token", "legacy-plaintext");
    const fetchMock = vi.fn().mockResolvedValue(res(200, tokenResponse("new-refresh")));
    vi.stubGlobal("fetch", fetchMock);

    const { auth } = await loadAuth();
    const { data } = await auth.getSession();

    expect(data.session?.user.id).toBe("user-1");
    expect(JSON.parse(secureValue!)).toEqual({ c: "operon-app", t: "new-refresh" });
    expect(window.localStorage.getItem("kc_refresh_token")).toBeNull();
    expect(window.localStorage.getItem("kc_token")).toBeTruthy();
  });

  it("stays signed in-store (no logout) when the network is down at launch, and recovers when it returns", async () => {
    secureValue = JSON.stringify({ c: "operon-app", t: "r1" });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const { auth } = await loadAuth();
    const pending = auth.getSession();
    await vi.advanceTimersByTimeAsync(20_000);
    const first = await pending;

    expect(first.data.session).toBeNull();
    expect(secureValue).not.toBeNull(); // refresh token kept: this was not an expiry
    expect(fakeStore.remove).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(res(200, tokenResponse("r2")));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    const second = await auth.getSession();
    expect(second.data.session?.user.id).toBe("user-1");
    expect(JSON.parse(secureValue!).t).toBe("r2");
  });

  it("wipes the stored session when the server says it is expired or revoked", async () => {
    secureValue = JSON.stringify({ c: "operon-app", t: "dead" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(400, { error: "invalid_grant" })));

    const { auth } = await loadAuth();
    const { data } = await auth.getSession();

    expect(data.session).toBeNull();
    expect(secureValue).toBeNull();
    expect(window.localStorage.getItem("kc_token")).toBeNull();
  });

  it("refreshes proactively before the access token expires", async () => {
    secureValue = JSON.stringify({ c: "operon-app", t: "r1" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, tokenResponse("r2", 150))) // expires in 150s
      .mockResolvedValue(res(200, tokenResponse("r3", 600)));
    vi.stubGlobal("fetch", fetchMock);

    const { auth } = await loadAuth();
    await auth.getSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(61_000); // < 120s of validity left -> next tick refreshes
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(secureValue!).t).toBe("r3");
  });

  it("explicit sign-out revokes server-side and clears every local copy", async () => {
    secureValue = JSON.stringify({ c: "operon-app", t: "r1" });
    const fetchMock = vi.fn().mockResolvedValue(res(200, tokenResponse("r1b")));
    vi.stubGlobal("fetch", fetchMock);

    const { auth } = await loadAuth();
    await auth.getSession();
    const out = await auth.signOut();

    expect(out).toEqual({ error: null, redirected: false });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith("/openid-connect/revoke"))).toBe(true);
    expect(secureValue).toBeNull();
    expect(window.localStorage.getItem("kc_token")).toBeNull();
    expect((await auth.getSession()).data.session).toBeNull();
  });

  it("password login uses the app client and stores only the refresh token securely", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, tokenResponse("login-refresh")));
    vi.stubGlobal("fetch", fetchMock);

    const { auth } = await loadAuth();
    const r = await auth.signInWithPassword({ email: "u@x.in", password: "pw" });

    expect(r.error).toBeNull();
    const sent = new URLSearchParams((fetchMock.mock.calls[0][1] as RequestInit).body!.toString());
    expect(sent.get("client_id")).toBe("operon-app");
    expect(JSON.parse(secureValue!)).toEqual({ c: "operon-app", t: "login-refresh" });
    expect(window.localStorage.getItem("kc_refresh_token")).toBeNull();
  });
});

describe("auth on the website (no secure storage)", () => {
  it("keeps the original client and never touches app-session storage", async () => {
    storeAvailable = false;
    secureValue = JSON.stringify({ c: "operon-app", t: "ignored" });
    fakeStore.get.mockClear();
    fakeStore.set.mockClear();
    vi.stubGlobal("fetch", vi.fn());

    const { auth, initKeycloak } = await loadAuth();
    await initKeycloak();
    await auth.getSession();

    expect(fakeStore.get).not.toHaveBeenCalled();
    expect(fakeStore.set).not.toHaveBeenCalled();
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSecureStore = vi.fn();
const keycloakConfigs: any[] = [];

vi.mock("@/lib/secure-storage", () => ({ getSecureStore: () => getSecureStore() }));
vi.mock("keycloak-js", () => ({
  default: class {
    authServerUrl = "https://auth.example";
    constructor(cfg: any) {
      keycloakConfigs.push(cfg);
    }
    init = vi.fn(async () => false);
    login = vi.fn();
    register = vi.fn();
    logout = vi.fn();
    updateToken = vi.fn();
  },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({})) },
}));

const fakeStore = () => ({
  get: vi.fn(async () => null),
  set: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
});

function jwt(payload: object) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=/g, "");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

async function load() {
  vi.resetModules();
  return {
    profile: await import("@/integrations/backend/auth-profile"),
    auth: await import("@/integrations/backend/auth"),
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  getSecureStore.mockReset();
  keycloakConfigs.length = 0;
  window.localStorage.clear();
});

describe("auth profile selection", () => {
  it("flag OFF (default): website client, and secure storage is never touched", async () => {
    getSecureStore.mockReturnValue(fakeStore());
    const { profile } = await load();
    const p = profile.resolveAuthProfile();
    expect(p).toEqual({ clientId: "execution-os", scope: "openid profile email", store: null });
    expect(getSecureStore).not.toHaveBeenCalled();
  });

  it("flag ON but plain website (no secure storage): still execution-os", async () => {
    vi.stubEnv("VITE_NATIVE_PERSISTENT_LOGIN", "true");
    getSecureStore.mockReturnValue(null);
    const { profile } = await load();
    expect(profile.resolveAuthProfile().clientId).toBe("execution-os");
    expect(profile.resolveAuthProfile().store).toBeNull();
  });

  it("flag ON + secure storage available: operon-app with offline_access", async () => {
    vi.stubEnv("VITE_NATIVE_PERSISTENT_LOGIN", "true");
    const store = fakeStore();
    getSecureStore.mockReturnValue(store);
    const { profile } = await load();
    expect(profile.resolveAuthProfile()).toEqual({
      clientId: "operon-app",
      scope: "openid profile email offline_access",
      store,
    });
  });

  it("flag must be exactly 'true'", async () => {
    vi.stubEnv("VITE_NATIVE_PERSISTENT_LOGIN", "1");
    getSecureStore.mockReturnValue(fakeStore());
    const { profile } = await load();
    expect(profile.resolveAuthProfile().clientId).toBe("execution-os");
  });
});

describe("website auth module is unchanged", () => {
  it("creates keycloak with execution-os and never reads secure storage (flag off)", async () => {
    const store = fakeStore();
    getSecureStore.mockReturnValue(store);
    await load();
    expect(keycloakConfigs[0]).toMatchObject({ realm: "lovable", clientId: "execution-os" });
    expect(getSecureStore).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it("password login uses execution-os, old scope, and localStorage refresh token", async () => {
    const store = fakeStore();
    getSecureStore.mockReturnValue(store);
    const { auth } = await load();
    const access = jwt({ sub: "u1", email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 3600 });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: access, refresh_token: "web-rt" }), {
          status: 200,
        }),
    );
    globalThis.fetch = fetchMock as never;

    const res = await auth.auth.signInWithPassword({ email: "a@b.c", password: "pw" });
    expect(res.error).toBeNull();

    const body = new URLSearchParams((fetchMock.mock.calls[0] as any)[1].body.toString());
    expect(body.get("client_id")).toBe("execution-os");
    expect(body.get("scope")).toBe("openid profile email");
    expect(window.localStorage.getItem("kc_refresh_token")).toBe("web-rt");
    expect(window.localStorage.getItem("kc_client")).toBeNull();
    expect(getSecureStore).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });
});

describe("native (operon-app) session", () => {
  it("uses operon-app, stores the refresh token only in secure storage", async () => {
    vi.stubEnv("VITE_NATIVE_PERSISTENT_LOGIN", "true");
    const store = fakeStore();
    getSecureStore.mockReturnValue(store);
    const { auth } = await load();
    expect(keycloakConfigs[0].clientId).toBe("operon-app");

    const access = jwt({ sub: "u1", email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 3600 });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: access, refresh_token: "offline-rt" }), {
          status: 200,
        }),
    );
    globalThis.fetch = fetchMock as never;

    const res = await auth.auth.signInWithPassword({ email: "a@b.c", password: "pw" });
    expect(res.error).toBeNull();
    const body = new URLSearchParams((fetchMock.mock.calls[0] as any)[1].body.toString());
    expect(body.get("client_id")).toBe("operon-app");
    expect(body.get("scope")).toContain("offline_access");
    expect(store.set).toHaveBeenCalledWith("refresh_token", "offline-rt");
    expect(window.localStorage.getItem("kc_refresh_token")).toBeNull();
    expect(window.localStorage.getItem("kc_token")).toBe(access);
  });

  it("logout revokes server-side and wipes local + secure storage", async () => {
    vi.stubEnv("VITE_NATIVE_PERSISTENT_LOGIN", "true");
    const store = fakeStore();
    store.get.mockResolvedValue("offline-rt" as never);
    getSecureStore.mockReturnValue(store);
    const { auth } = await load();
    window.localStorage.setItem("kc_token", "x");
    const fetchMock = vi.fn(async () => new Response("", { status: 204 }));
    globalThis.fetch = fetchMock as never;

    const res = await auth.auth.signOut();
    expect(res).toEqual({ error: null, redirected: false });
    const urls = fetchMock.mock.calls.map((c) => String((c as any)[0]));
    expect(urls.some((u) => u.endsWith("/openid-connect/revoke"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/openid-connect/logout"))).toBe(true);
    expect(store.remove).toHaveBeenCalledWith("refresh_token");
    expect(window.localStorage.getItem("kc_token")).toBeNull();
  });

  it("drops stale execution-os tokens on first native start", async () => {
    vi.stubEnv("VITE_NATIVE_PERSISTENT_LOGIN", "true");
    const store = fakeStore();
    getSecureStore.mockReturnValue(store);
    const { auth } = await load();
    window.localStorage.setItem("kc_token", "old-web-token");
    window.localStorage.setItem("kc_refresh_token", "old-web-rt");
    await auth.initKeycloak();
    expect(window.localStorage.getItem("kc_token")).toBeNull();
    expect(window.localStorage.getItem("kc_refresh_token")).toBeNull();
    expect(window.localStorage.getItem("kc_client")).toBe("operon-app");
  });
});

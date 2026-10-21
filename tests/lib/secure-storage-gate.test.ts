/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { getSecureStore, isSecureOrigin } from "@/lib/secure-storage";

const require_ = createRequire(import.meta.url);
const { isSecureBaseUrl, isTrustedSenderUrl } = require_("../../desktop/secure-gate.js") as {
  isSecureBaseUrl: (u: string) => boolean;
  isTrustedSenderUrl: (sender: string, base: string) => boolean;
};

const https = { protocol: "https:", hostname: "operon.noesisanalytics.co.in" };
const http = { protocol: "http:", hostname: "operon.noesisanalytics.co.in" };

afterEach(() => {
  delete (window as any).operonDesktop;
});

function installDesktopBridge() {
  (window as any).operonDesktop = {
    secureStore: {
      available: true,
      get: async () => null,
      set: async () => {},
      remove: async () => {},
    },
  };
}

describe("renderer HTTPS gate", () => {
  it("allows https and loopback only", () => {
    expect(isSecureOrigin(https)).toBe(true);
    expect(isSecureOrigin({ protocol: "http:", hostname: "localhost" })).toBe(true);
    expect(isSecureOrigin({ protocol: "http:", hostname: "127.0.0.1" })).toBe(true);
    expect(isSecureOrigin(http)).toBe(false);
    expect(isSecureOrigin({ protocol: "file:", hostname: "" })).toBe(false);
  });

  it("refuses secure storage on a plain-http page even when the bridge exists", () => {
    installDesktopBridge();
    expect(getSecureStore(http)).toBeNull();
    expect(getSecureStore(https)).not.toBeNull();
  });

  it("is null when there is no native bridge", () => {
    expect(getSecureStore(https)).toBeNull();
  });
});

describe("Electron main-process HTTPS gate", () => {
  it("only offers the token store for https or loopback base URLs", () => {
    expect(isSecureBaseUrl("https://operon.noesisanalytics.co.in")).toBe(true);
    expect(isSecureBaseUrl("http://localhost:7050")).toBe(true);
    expect(isSecureBaseUrl("http://127.0.0.1:7050")).toBe(true);
    expect(isSecureBaseUrl("http://operon.noesisanalytics.co.in")).toBe(false);
    expect(isSecureBaseUrl("ftp://operon.noesisanalytics.co.in")).toBe(false);
    expect(isSecureBaseUrl("not a url")).toBe(false);
  });
});

describe("Electron sender trust (HTTP -> HTTPS redirect)", () => {
  const httpBase = "http://operon.noesisanalytics.co.in";

  it("trusts the https page the server redirected an http base URL to", () => {
    expect(isTrustedSenderUrl("https://operon.noesisanalytics.co.in/login", httpBase)).toBe(true);
    expect(
      isTrustedSenderUrl(
        "https://operon.noesisanalytics.co.in/",
        "https://operon.noesisanalytics.co.in",
      ),
    ).toBe(true);
  });

  it("rejects a plain-http page on a non-loopback host, even the configured one", () => {
    expect(isTrustedSenderUrl("http://operon.noesisanalytics.co.in/login", httpBase)).toBe(false);
    expect(
      isTrustedSenderUrl(
        "http://operon.noesisanalytics.co.in/",
        "https://operon.noesisanalytics.co.in",
      ),
    ).toBe(false);
  });

  it("rejects other hosts, look-alikes, non-default ports and the Keycloak host", () => {
    expect(isTrustedSenderUrl("https://evil.example/login", httpBase)).toBe(false);
    expect(isTrustedSenderUrl("https://operon.noesisanalytics.co.in.evil.example/", httpBase)).toBe(
      false,
    );
    expect(isTrustedSenderUrl("https://auth.noesisanalytics.co.in/", httpBase)).toBe(false);
    expect(isTrustedSenderUrl("https://operon.noesisanalytics.co.in:8443/", httpBase)).toBe(false);
    expect(
      isTrustedSenderUrl(
        "https://operon.noesisanalytics.co.in:8443/",
        "https://operon.noesisanalytics.co.in",
      ),
    ).toBe(false);
  });

  it("allows loopback http only when the base is that same loopback origin", () => {
    expect(isTrustedSenderUrl("http://localhost:7050/login", "http://localhost:7050")).toBe(true);
    expect(isTrustedSenderUrl("http://localhost:7050/login", httpBase)).toBe(false);
    expect(isTrustedSenderUrl("http://localhost:9999/", "http://localhost:7050")).toBe(false);
  });

  it("rejects malformed or non-web URLs", () => {
    expect(isTrustedSenderUrl("", httpBase)).toBe(false);
    expect(isTrustedSenderUrl("not a url", httpBase)).toBe(false);
    expect(isTrustedSenderUrl("file:///C:/x.html", httpBase)).toBe(false);
    expect(isTrustedSenderUrl("https://operon.noesisanalytics.co.in/", "garbage")).toBe(false);
  });
});

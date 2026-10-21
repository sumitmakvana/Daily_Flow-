/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { getSecureStore, isSecureOrigin } from "@/lib/secure-storage";

const require_ = createRequire(import.meta.url);
const { isSecureBaseUrl } = require_("../../desktop/secure-gate.js") as {
  isSecureBaseUrl: (u: string) => boolean;
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

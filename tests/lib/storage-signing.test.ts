import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signStoragePath, verifyStoragePath } from "@/lib/storage-signing.server";

const PATH = "work-items/abc/report.pdf";
const LEGACY_DEFAULT = "default-fallback-storage-secret";

describe("storage link signing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps links signed with CRON_SECRET valid (same HMAC as before)", () => {
    vi.stubEnv("STORAGE_SIGNING_SECRET", "");
    vi.stubEnv("CRON_SECRET", "cron-key");
    const expires = Date.now() + 60_000;
    const legacy = createHmac("sha256", "cron-key").update(`${PATH}:${expires}`).digest("hex");
    expect(signStoragePath(PATH, expires)).toBe(legacy);
    expect(verifyStoragePath(PATH, expires, legacy)).toBe(true);
  });

  it("prefers STORAGE_SIGNING_SECRET over CRON_SECRET", () => {
    vi.stubEnv("STORAGE_SIGNING_SECRET", "storage-key");
    vi.stubEnv("CRON_SECRET", "cron-key");
    const expires = Date.now() + 60_000;
    const withCron = createHmac("sha256", "cron-key").update(`${PATH}:${expires}`).digest("hex");
    expect(verifyStoragePath(PATH, expires, withCron)).toBe(false);
    expect(verifyStoragePath(PATH, expires, signStoragePath(PATH, expires))).toBe(true);
  });

  it("never accepts a link signed with the old fixed fallback string", () => {
    vi.stubEnv("STORAGE_SIGNING_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");
    const expires = Date.now() + 60_000;
    const forged = createHmac("sha256", LEGACY_DEFAULT).update(`${PATH}:${expires}`).digest("hex");
    expect(verifyStoragePath(PATH, expires, forged)).toBe(false);
    expect(verifyStoragePath(PATH, expires, signStoragePath(PATH, expires))).toBe(true);
  });

  it("rejects expired, tampered and malformed tokens", () => {
    vi.stubEnv("CRON_SECRET", "cron-key");
    const past = Date.now() - 1;
    expect(verifyStoragePath(PATH, past, signStoragePath(PATH, past))).toBe(false);
    const expires = Date.now() + 60_000;
    const token = signStoragePath(PATH, expires);
    expect(verifyStoragePath("work-items/other.pdf", expires, token)).toBe(false);
    expect(verifyStoragePath(PATH, expires + 1, token)).toBe(false);
    expect(verifyStoragePath(PATH, expires, "not-hex")).toBe(false);
    expect(verifyStoragePath(PATH, expires, "")).toBe(false);
    expect(verifyStoragePath(PATH, Number.NaN, token)).toBe(false);
  });
});

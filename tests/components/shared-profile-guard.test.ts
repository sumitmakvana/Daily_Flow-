// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Static guard: the app shell, My Day and the morning prompt must read the user's own profile
// through the shared loader, not with three separate `profiles?id=eq.<me>` requests.

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
const FILES = [
  "src/components/AppShell.tsx",
  "src/routes/_authenticated/my-day.tsx",
  "src/components/MorningResumePromptModal.tsx",
];

describe("own-profile reads are shared", () => {
  it.each(FILES)("%s uses loadMyProfile", (f) => {
    expect(read(f)).toMatch(/loadMyProfile\(/);
  });

  it.each(FILES)("%s does not query its own profile row directly", (f) => {
    const src = read(f);
    // from("profiles") ... .eq("id", user.id)  (the per-row lookup that used to be duplicated)
    expect(src).not.toMatch(/from\(\s*["']profiles["']\s*\)[\s\S]{0,160}?\.eq\(\s*["']id["']\s*,\s*user\.id\s*\)/);
  });

  it("the layout reads roles through the shared loader, not getMyRoles directly", () => {
    const src = read("src/routes/_authenticated.tsx");
    expect(src).toMatch(/getRolesShared\(/);
    expect(src).not.toMatch(/getMyRoles/);
  });
});

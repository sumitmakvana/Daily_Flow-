import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("lib/utils.cn", () => {
  it("merges classes", () => {
    expect(cn("a", "b")).toBe("a b");
  });
  it("dedupes tailwind classes", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
  it("handles falsy", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });
  it("handles conditional object", () => {
    expect(cn({ a: true, b: false }, "c")).toBe("a c");
  });
});

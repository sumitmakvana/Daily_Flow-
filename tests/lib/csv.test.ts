import { describe, it, expect, vi } from "vitest";
import { parseCSV, toCSV, downloadCSV } from "@/lib/csv";

describe("lib/csv", () => {
  describe("parseCSV", () => {
    it("parses simple csv", () => {
      const r = parseCSV("a,b\n1,2\n3,4");
      expect(r).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
    });
    it("handles quoted fields with commas and quotes", () => {
      const r = parseCSV('a,b\n"hi, there","he said ""ok"""');
      expect(r).toEqual([{ a: "hi, there", b: 'he said "ok"' }]);
    });
    it("normalizes \\r\\n line endings", () => {
      expect(parseCSV("a,b\r\n1,2")).toEqual([{ a: "1", b: "2" }]);
    });
    it("returns empty array for empty input", () => {
      expect(parseCSV("")).toEqual([]);
    });
    it("skips fully empty rows", () => {
      expect(parseCSV("a\n1\n\n2")).toEqual([{ a: "1" }, { a: "2" }]);
    });
    it("handles trailing field without newline", () => {
      expect(parseCSV("a,b\n1,2")).toEqual([{ a: "1", b: "2" }]);
    });
    it("handles embedded newlines in quoted fields", () => {
      expect(parseCSV('a,b\n"line1\nline2",x')).toEqual([{ a: "line1\nline2", b: "x" }]);
    });
  });

  describe("toCSV", () => {
    it("escapes quotes/commas/newlines", () => {
      const out = toCSV([{ a: 'hi, "there"', b: "n\nl" }], ["a", "b"]);
      expect(out).toBe('a,b\n"hi, ""there""","n\nl"');
    });
    it("handles null/undefined as empty", () => {
      expect(toCSV([{ a: null, b: undefined }], ["a", "b"])).toBe("a,b\n,");
    });
    it("works with no rows", () => {
      expect(toCSV([], ["a", "b"])).toBe("a,b");
    });
  });

  describe("downloadCSV", () => {
    it("creates an anchor and triggers click", () => {
      const click = vi.fn();
      const orig = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = orig(tag) as HTMLAnchorElement;
        if (tag === "a") el.click = click;
        return el;
      });
      downloadCSV("test.csv", "a,b\n1,2");
      expect(click).toHaveBeenCalled();
      vi.restoreAllMocks();
    });
  });
});

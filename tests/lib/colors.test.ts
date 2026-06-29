import { describe, it, expect } from "vitest";
import { statusColor, priorityColor, priorityDot } from "@/lib/colors";

describe("lib/colors", () => {
  it("has class for each status", () => {
    for (const s of ["To Do","In Progress","In Review","Blocked","On Hold","Completed"] as const) {
      expect(statusColor[s]).toMatch(/text-status-/);
    }
  });
  it("has class for each priority", () => {
    for (const p of ["High","Medium","Low"] as const) {
      expect(priorityColor[p]).toMatch(/text-priority-/);
      expect(priorityDot[p]).toMatch(/bg-priority-/);
    }
  });
});

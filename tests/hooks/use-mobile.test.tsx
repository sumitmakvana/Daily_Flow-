import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "@/hooks/use-mobile";

describe("useIsMobile", () => {
  it("returns true at narrow widths and updates on change", () => {
    const listeners: Array<() => void> = [];
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn(() => ({
        matches: true,
        addEventListener: (_: string, cb: () => void) => listeners.push(cb),
        removeEventListener: vi.fn(),
      })),
    });
    Object.defineProperty(window, "innerWidth", { writable: true, value: 500 });
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    act(() => {
      (window as unknown as { innerWidth: number }).innerWidth = 1024;
      listeners.forEach((l) => l());
    });
    expect(result.current).toBe(false);
  });
});

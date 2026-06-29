import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { mockSupabase } from "../mocks/supabase";
import { useRealtimeTasks } from "@/hooks/use-realtime-tasks";

describe("useRealtimeTasks", () => {
  beforeEach(() => mockSupabase.reset());

  it("subscribes and unsubscribes on unmount", () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useRealtimeTasks(onChange));
    expect(mockSupabase.channelSubs.length).toBeGreaterThan(0);
    unmount();
    expect(mockSupabase.removeChannel).toHaveBeenCalled();
  });
});

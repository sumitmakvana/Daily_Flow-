import { describe, it, expect, beforeEach } from "vitest";
import { mockSupabase } from "../mocks/supabase";
import { workItemTypesService } from "@/services/work-item-types";

describe("services/work-item-types", () => {
  beforeEach(() => mockSupabase.reset());

  it("list returns active types ordered", async () => {
    mockSupabase.queueResponse("select", {
      data: [
        { id: "1", key: "task", name: "Task", description: null, icon: "CheckSquare", color: "primary", active: true, sort_order: 10 },
        { id: "2", key: "visit", name: "Visit", description: null, icon: "MapPin", color: null, active: true, sort_order: 20 },
      ],
    });
    const list = await workItemTypesService.list();
    expect(list).toHaveLength(2);
    expect(list[0].key).toBe("task");
    expect(mockSupabase.calls.from).toContain("work_item_types");
  });

  it("list throws on error", async () => {
    mockSupabase.queueResponse("select", { error: { message: "x" } });
    await expect(workItemTypesService.list()).rejects.toBeTruthy();
  });
});

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// HealthPanel must use the same recovery mechanism as the rest of the app: targeted resync after a
// reconnect (refetch only if automation_health changed or everything must be refetched) and the one
// shared safety refresh while disconnected. It must not run its own onRealtimeConnect refetch.

const handlers = {
  event: null as null | (() => void),
  resync: null as null | ((i: { full: boolean; tables: string[] }) => void),
  safety: null as null | (() => void),
};
const unsub = vi.fn();
vi.mock("@/integrations/realtime/socket", () => ({
  onRealtime: (_e: string, h: () => void) => ((handlers.event = h), unsub),
  onRealtimeResync: (h: never) => ((handlers.resync = h), unsub),
  onRealtimeSafetyRefresh: (h: () => void) => ((handlers.safety = h), unsub),
}));

const health = vi.fn();
vi.mock("@/services/automations", () => ({ automationsService: { health: () => health() } }));

import { HealthPanel } from "@/components/automation/HealthPanel";

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  health.mockReset();
  health.mockResolvedValue({ pending_count: 0, runs_24h: 0, failed_24h: 0, dead_24h: 0, active_rules: 0, auto_disabled_rules: 0 });
  unsub.mockClear();
});

describe("HealthPanel realtime", () => {
  it("loads once, then refetches on its own event", async () => {
    render(<HealthPanel />);
    await flush();
    expect(health).toHaveBeenCalledTimes(1);
    handlers.event!();
    await flush();
    expect(health).toHaveBeenCalledTimes(2);
  });

  it("after a resync it refetches only when automation_health changed or a full refresh is asked", async () => {
    render(<HealthPanel />);
    await flush();
    health.mockClear();
    handlers.resync!({ full: false, tables: ["tasks", "nudges"] });
    await flush();
    expect(health).not.toHaveBeenCalled();
    handlers.resync!({ full: false, tables: ["automation_health"] });
    await flush();
    expect(health).toHaveBeenCalledTimes(1);
    handlers.resync!({ full: true, tables: [] });
    await flush();
    expect(health).toHaveBeenCalledTimes(2);
  });

  it("the shared safety refresh refetches, and unmount unsubscribes from all three", async () => {
    const { unmount } = render(<HealthPanel />);
    await flush();
    health.mockClear();
    handlers.safety!();
    await flush();
    expect(health).toHaveBeenCalledTimes(1);
    unmount();
    expect(unsub).toHaveBeenCalledTimes(3);
  });
});

/**
 * Turns raw Postgres `entity_changed` notifications into Socket.IO events.
 * Pure (no I/O): the listener feeds it messages and supplies the emit function,
 * which keeps routing and batching unit-testable.
 *
 * Message shape (from the notify_entity_changed() trigger):
 *   { table, op: INSERT|UPDATE|DELETE, id, ...routing columns }
 * Output: one `entity:changed` event per change, shaped like a Supabase
 * postgres_changes payload: { schema, table, eventType, new, old }.
 *
 * Routing (who may be told that something changed; payloads carry ids only,
 * and clients still read the data over REST, which enforces RLS):
 *   tasks                -> every signed-in user. The tasks_read_all RLS policy lets
 *                           any authenticated user read any task, and team boards,
 *                           calendars and lists show other people's tasks, so a
 *                           narrower audience would leave those views stale. The
 *                           event reveals nothing a user cannot already query.
 *   nudges               -> the nudge's owner only
 *   risk_events          -> managers
 *   planning_suggestions -> managers
 */

/** Room every authenticated socket joins (see realtime.server.ts). */
export const ALL_USERS_ROOM = "authenticated";

export type EntityOp = "INSERT" | "UPDATE" | "DELETE";

export type EntityMessage = {
  table?: unknown;
  op?: unknown;
  id?: unknown;
  [key: string]: unknown;
};

export type ChangeEvent = {
  schema: "public";
  table: string;
  eventType: EntityOp;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
  /** Set when many changes were collapsed into one "refetch" signal. */
  bulk?: boolean;
};

export type Delivery = { rooms: string[]; event: ChangeEvent };

const OPS = new Set<string>(["INSERT", "UPDATE", "DELETE"]);
const userRoom = (id: unknown) => (typeof id === "string" && id ? `user:${id}` : null);
const compact = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x))];

/** Decide where one change goes. Returns null for anything unknown/invalid. */
export function routeEntityMessage(msg: EntityMessage): Delivery | null {
  if (typeof msg?.table !== "string" || typeof msg.op !== "string" || !OPS.has(msg.op)) return null;
  const op = msg.op as EntityOp;
  const table = msg.table;
  if (typeof msg.id !== "string") return null;

  let row: Record<string, unknown>;
  let oldRow: Record<string, unknown> = {};
  let rooms: string[];

  switch (table) {
    case "tasks": {
      row = { id: msg.id, assigned_to: msg.assigned_to ?? null, reviewer: msg.reviewer ?? null };
      if (op === "UPDATE") {
        oldRow = {
          id: msg.id,
          assigned_to: msg.old_assigned_to ?? null,
          reviewer: msg.old_reviewer ?? null,
        };
      }
      // assigned_to/reviewer (new and old) stay in the payload only so client-side
      // filters like `assigned_to=eq.me` can ignore changes that are not theirs.
      rooms = [ALL_USERS_ROOM];
      break;
    }
    case "nudges": {
      row = { id: msg.id, user_id: msg.user_id ?? null };
      rooms = compact([userRoom(msg.user_id)]);
      break;
    }
    case "risk_events": {
      row = { id: msg.id, entity_type: msg.entity_type ?? null, entity_id: msg.entity_id ?? null };
      rooms = ["role:manager"];
      break;
    }
    case "planning_suggestions": {
      row = {
        id: msg.id,
        task_id: msg.task_id ?? null,
        from_user_id: msg.from_user_id ?? null,
        to_user_id: msg.to_user_id ?? null,
      };
      rooms = ["role:manager"];
      break;
    }
    default:
      return null;
  }

  if (rooms.length === 0) return null;
  // postgres_changes convention: DELETE carries the row in `old`, not `new`.
  const event: ChangeEvent =
    op === "DELETE"
      ? { schema: "public", table, eventType: op, new: {}, old: row }
      : { schema: "public", table, eventType: op, new: row, old: oldRow };
  return { rooms, event };
}

type Pending = Delivery & { firstOld: Record<string, unknown> };

export type BatcherOptions = {
  emit: (rooms: string[], event: string, payload: ChangeEvent) => void;
  /** Coalescing window. */
  windowMs?: number;
  /** More than this many changes to one table in a window collapse to one signal. */
  bulkThreshold?: number;
};

/**
 * Coalesces bursts. Within one window, repeated changes to the same row are
 * delivered once (to every room that was involved), and a flood of changes to a
 * table (e.g. a bulk update) becomes a single "refetch" signal.
 */
export class EntityEventBatcher {
  private pending = new Map<string, Pending>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly windowMs: number;
  private readonly bulkThreshold: number;

  constructor(private readonly opts: BatcherOptions) {
    this.windowMs = opts.windowMs ?? 100;
    this.bulkThreshold = opts.bulkThreshold ?? 100;
  }

  push(msg: EntityMessage): void {
    const d = routeEntityMessage(msg);
    if (!d) return;
    const key = `${d.event.table}:${d.event.eventType}:${msg.id as string}`;
    const prev = this.pending.get(key);
    if (prev) {
      // Latest state wins, but keep every room that was involved and the
      // earliest `old`, so someone who lost the task mid-window is still told.
      prev.rooms = compact([...prev.rooms, ...d.rooms]);
      prev.event = { ...d.event, old: prev.firstOld };
    } else {
      this.pending.set(key, { ...d, firstOld: d.event.old });
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.windowMs);
      this.timer.unref?.();
    }
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = [...this.pending.values()];
    this.pending.clear();

    const byTable = new Map<string, Pending[]>();
    for (const p of batch) {
      const list = byTable.get(p.event.table) ?? [];
      list.push(p);
      byTable.set(p.event.table, list);
    }

    for (const [table, list] of byTable) {
      try {
        if (list.length > this.bulkThreshold) {
          const rooms = compact(list.flatMap((p) => p.rooms));
          this.opts.emit(rooms, "entity:changed", {
            schema: "public",
            table,
            eventType: "UPDATE",
            new: {},
            old: {},
            bulk: true,
          });
        } else {
          for (const p of list) this.opts.emit(p.rooms, "entity:changed", p.event);
        }
      } catch (err) {
        console.warn("[EntityEvents] emit failed:", (err as Error).message);
      }
    }
  }
}

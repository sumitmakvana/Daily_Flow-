/**
 * Turns committed outbox events (see supabase/migrations/20261031000000_realtime_outbox.sql and
 * outbox-listener.server.ts) into Socket.IO events for exactly the users who may see them.
 * Pure (no I/O): the listener feeds it messages and supplies the emit function, which keeps routing
 * and batching unit-testable.
 *
 * Message shape (flat; produced by the outbox listener from realtime.outbox):
 *   { table, op: INSERT|UPDATE|DELETE|TRUNCATE, id, ...routing user ids }
 * Output: one `entity:changed` event per change, shaped like a Supabase postgres_changes payload:
 * { schema, table, eventType, new, old }. Payloads carry ids only, never row content; clients read
 * the data over REST, which enforces RLS.
 *
 * Audience (who is told that something changed). Nobody is told about everything:
 *   tasks                 assignee (new + old), reviewer(s), creator, managers
 *   task_review_decisions that reviewer, whoever decided, the other reviewers, the task's assignee, managers
 *   task_worklogs         the logger, the task's assignee, managers
 *   leaves                the owner, the person asked to approve, the reviewer, managers
 *   eod_checkins          the owner, managers (same as the eod_read_self_or_mgr policy)
 *   nudges                the owner
 *   risk_events           managers
 *   planning_suggestions  managers
 *   approval_requests     the requester, the chain's approvers, admins (same as the ar_read policy)
 * Managers are admins' superset room: admin sockets also join role:manager (realtime.server.ts).
 * TRUNCATE has no owner to name, so it is the one case sent to every signed-in user (or the table's
 * whole audience class): a destructive, rare operation where "everyone refetch" is the safe answer.
 */

/** Room every authenticated socket joins (see realtime.server.ts). */
export const ALL_USERS_ROOM = "authenticated";
export const MANAGERS_ROOM = "role:manager";
export const ADMINS_ROOM = "role:admin";

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

export type Delivery = { rooms: string[]; event: ChangeEvent; eventName: string };

const OPS = new Set<string>(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);
const ENTITY_EVENT = "entity:changed";

const uuidish = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const userRoom = (id: unknown) => {
  const v = uuidish(id);
  return v ? `user:${v}` : null;
};
const compact = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => !!x))];
/** user rooms for any mix of single ids and id arrays */
const usersOf = (...vals: unknown[]) =>
  compact(vals.flatMap((v) => (Array.isArray(v) ? v.map(userRoom) : [userRoom(v)])));

/** Everything but `id` is a routing key; this picks the ones a client filter may use. */
const pick = (msg: EntityMessage, keys: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = msg[k] ?? null;
  return out;
};

/** Audience class of a table, used for TRUNCATE where no row names an owner. */
function truncateRooms(table: string): string[] | null {
  switch (table) {
    case "risk_events":
    case "planning_suggestions":
      return [MANAGERS_ROOM];
    case "tasks":
    case "nudges":
    case "approval_requests":
    case "task_review_decisions":
    case "task_worklogs":
    case "leaves":
    case "eod_checkins":
      return [ALL_USERS_ROOM];
    default:
      return null;
  }
}

/** Decide where one change goes. Returns null for anything unknown/invalid. */
export function routeEntityMessage(msg: EntityMessage): Delivery | null {
  if (typeof msg?.table !== "string" || typeof msg.op !== "string" || !OPS.has(msg.op)) return null;
  const table = msg.table;

  if (msg.op === "TRUNCATE") {
    const rooms = truncateRooms(table);
    if (!rooms) return null;
    const event: ChangeEvent = { schema: "public", table, eventType: "UPDATE", new: {}, old: {}, bulk: true };
    return { rooms, event, eventName: ENTITY_EVENT };
  }

  const op = msg.op as EntityOp;
  if (typeof msg.id !== "string") return null;

  let row: Record<string, unknown>;
  let oldRow: Record<string, unknown> = {};
  let rooms: string[];

  switch (table) {
    case "tasks": {
      row = { id: msg.id, assigned_to: msg.assigned_to ?? null, reviewer: msg.reviewer ?? null };
      if (op === "UPDATE") {
        oldRow = { id: msg.id, assigned_to: msg.old_assigned_to ?? null, reviewer: msg.old_reviewer ?? null };
      }
      // assigned_to/reviewer (new and old) stay in the payload so client filters like
      // `assigned_to=eq.me` can ignore changes that are not theirs.
      rooms = [
        ...usersOf(msg.assigned_to, msg.old_assigned_to, msg.reviewer, msg.old_reviewer, msg.created_by, msg.reviewers),
        MANAGERS_ROOM,
      ];
      break;
    }
    case "task_review_decisions": {
      row = { id: msg.id, ...pick(msg, ["task_id", "reviewer_id"]) };
      rooms = [...usersOf(msg.reviewer_id, msg.decided_by, msg.assigned_to, msg.reviewers), MANAGERS_ROOM];
      break;
    }
    case "task_worklogs": {
      row = { id: msg.id, ...pick(msg, ["user_id", "task_id"]) };
      rooms = [...usersOf(msg.user_id, msg.assigned_to), MANAGERS_ROOM];
      break;
    }
    case "leaves": {
      row = { id: msg.id, ...pick(msg, ["user_id"]) };
      rooms = [...usersOf(msg.user_id, msg.request_to, msg.reviewed_by), MANAGERS_ROOM];
      break;
    }
    case "eod_checkins": {
      row = { id: msg.id, ...pick(msg, ["user_id"]) };
      rooms = [...usersOf(msg.user_id), MANAGERS_ROOM];
      break;
    }
    case "nudges": {
      row = { id: msg.id, ...pick(msg, ["user_id"]) };
      rooms = usersOf(msg.user_id);
      break;
    }
    case "risk_events": {
      row = { id: msg.id, ...pick(msg, ["entity_type", "entity_id"]) };
      rooms = [MANAGERS_ROOM];
      break;
    }
    case "planning_suggestions": {
      row = { id: msg.id, ...pick(msg, ["task_id", "from_user_id", "to_user_id"]) };
      rooms = [MANAGERS_ROOM];
      break;
    }
    case "approval_requests": {
      row = { id: msg.id, ...pick(msg, ["requested_by"]) };
      rooms = [...usersOf(msg.requested_by, msg.approvers), ADMINS_ROOM];
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
  return { rooms: compact(rooms), event, eventName: ENTITY_EVENT };
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
    const key = `${d.eventName}:${d.event.table}:${d.event.eventType}:${String(msg.id ?? "*")}`;
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
      const k = `${p.eventName}|${p.event.table}`;
      const list = byTable.get(k) ?? [];
      list.push(p);
      byTable.set(k, list);
    }

    for (const list of byTable.values()) {
      const { eventName, event } = list[0];
      try {
        if (list.length > this.bulkThreshold) {
          // One refetch signal for the table, to everyone who was in any of the audiences.
          const rooms = compact(list.flatMap((p) => p.rooms));
          this.opts.emit(rooms, eventName, { schema: "public", table: event.table, eventType: "UPDATE", new: {}, old: {}, bulk: true });
        } else {
          for (const p of list) this.opts.emit(p.rooms, p.eventName, p.event);
        }
      } catch (err) {
        console.warn("[EntityEvents] emit failed:", (err as Error).message);
      }
    }
  }
}

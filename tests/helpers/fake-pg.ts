/**
 * Minimal stateful stand-in for the Postgres pool, covering exactly the statements issued by
 * the timer code paths (task-timer.server, updateTaskFn, carryForwardWithTimerFn,
 * startTaskForUser). It models what matters for these tests:
 *   - real transactions: SELECT ... FOR UPDATE takes a per-row lock held until COMMIT/ROLLBACK,
 *     so concurrent requests serialize exactly as they would in Postgres;
 *   - the state they mutate (tasks, task_worklogs, task_history, carry_forward_events).
 * Unknown statements throw, so a changed query shape fails loudly instead of silently passing.
 */
export interface FakeTask {
  id: string;
  assigned_to: string;
  status: string;
  started_at: string | null;
  system_hours: number;
  version: number;
  due_date: string | null;
  carry_forward_count: number;
  [k: string]: unknown;
}

export interface FakeWorklog {
  task_id: string;
  user_id: string;
  work_date: string;
  system_hours: number;
  started_at: string | null;
}

export class FakeDb {
  tasks = new Map<string, FakeTask>();
  worklogs: FakeWorklog[] = [];
  history: Array<{ task_id: string; old_status: string; new_status: string; comment: string }> = [];
  carryEvents: Array<{ task_id: string; from_date: string | null; to_date: string }> = [];
  profileActive = true;
  private locks = new Map<string, Promise<void>>();

  addTask(t: Partial<FakeTask> & { id: string }): FakeTask {
    const row: FakeTask = {
      assigned_to: "u1",
      status: "To Do",
      started_at: null,
      system_hours: 0,
      version: 1,
      due_date: "2026-03-10",
      carry_forward_count: 0,
      ...t,
    };
    this.tasks.set(row.id, row);
    return row;
  }

  get(id: string): FakeTask {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`no task ${id}`);
    return t;
  }

  logsFor(id: string) {
    return this.worklogs.filter((w) => w.task_id === id);
  }

  loggedTotal(id: string) {
    return Math.round(this.logsFor(id).reduce((a, w) => a + w.system_hours, 0) * 100) / 100;
  }

  /** A pg-pool-like object: { connect() } and a withUser() compatible runner. */
  pool() {
    return { connect: async () => this.client() };
  }

  async withUser<T>(_userId: string, fn: (c: ReturnType<FakeDb["client"]>) => Promise<T>): Promise<T> {
    const c = this.client();
    try {
      await c.query("BEGIN");
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  private client() {
    const held: Array<() => void> = [];
    const releaseAll = () => {
      while (held.length) held.pop()!();
    };
    const lock = async (id: string) => {
      // Wait for the previous holder, then register our own release.
      for (;;) {
        const cur = this.locks.get(id);
        if (!cur) break;
        await cur;
      }
      let release!: () => void;
      const p = new Promise<void>((r) => (release = r));
      this.locks.set(id, p);
      held.push(() => {
        this.locks.delete(id);
        release();
      });
    };
    const day = (d: Date) => d.toISOString().slice(0, 10);

    const query = async (sql: string, params: unknown[] = []): Promise<{ rows: any[] }> => {
      const s = sql.replace(/\s+/g, " ").trim();
      const P = params as any[];

      if (s === "BEGIN" || /^SAVEPOINT|^RELEASE SAVEPOINT|^ROLLBACK TO SAVEPOINT/.test(s)) return { rows: [] };
      if (s === "COMMIT" || s === "ROLLBACK") {
        releaseAll();
        return { rows: [] };
      }
      if (/^SELECT set_config|^SET LOCAL/.test(s)) return { rows: [] };

      // ---- row-locking reads of one task --------------------------------
      if (/FROM public\.tasks WHERE id = \$1 FOR UPDATE$/.test(s)) {
        await lock(P[0]);
        const t = this.tasks.get(P[0]);
        return { rows: t ? [{ ...t }] : [] };
      }
      // ---- other running timers of a user -------------------------------
      if (/WHERE assigned_to = \$1 AND started_at IS NOT NULL AND status <> 'Completed'/.test(s)) {
        const rows = [...this.tasks.values()]
          .filter(
            (t) =>
              t.assigned_to === P[0] &&
              t.started_at !== null &&
              t.status !== "Completed" &&
              (P[1] == null || t.id !== P[1]),
          )
          .sort((a, b) => a.id.localeCompare(b.id));
        for (const r of rows) await lock(r.id);
        return { rows: rows.map((r) => ({ ...r })) };
      }
      if (/FROM public\.profiles/.test(s) || /SELECT is_active/.test(s)) {
        return { rows: [{ is_active: this.profileActive }] };
      }
      if (/^SELECT CURRENT_DATE/.test(s)) return { rows: [{ d: day(new Date()) }] };

      // ---- per-day split of a session -----------------------------------
      if (/generate_series/.test(s)) {
        const start = new Date(P[0]);
        const now = new Date();
        const rows: Array<{ work_date: string; hrs: number }> = [];
        const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
        while (d.getTime() <= now.getTime()) {
          const next = new Date(d.getTime() + 86400000);
          const hrs = (Math.min(now.getTime(), next.getTime()) - Math.max(start.getTime(), d.getTime())) / 3600000;
          rows.push({ work_date: day(d), hrs });
          d.setTime(next.getTime());
        }
        return { rows };
      }

      // ---- writes -------------------------------------------------------
      if (/^INSERT INTO public\.task_worklogs/.test(s)) {
        this.worklogs.push({
          task_id: P[0],
          user_id: P[1],
          work_date: P[2],
          system_hours: Number(P[3]),
          started_at: P[4],
        });
        return { rows: [] };
      }
      if (/^INSERT INTO public\.task_history/.test(s)) {
        const sameStatus = /$2, $2/.test(s); // pause: old = new = current status
        this.history.push({
          task_id: P[0],
          old_status: P[1],
          new_status: sameStatus ? P[1] : "In Progress",
          comment: String(P.at(-1)),
        });
        return { rows: [] };
      }
      if (/^INSERT INTO public\.carry_forward_events/.test(s)) {
        this.carryEvents.push({ task_id: P[0], from_date: P[1], to_date: P[2] });
        this.get(P[0]).carry_forward_count += 1; // AFTER INSERT trigger
        return { rows: [] };
      }
      if (/^INSERT INTO public\.notifications/.test(s)) return { rows: [] };

      // pauseOtherRunningTimers: stop timer only
      if (/^UPDATE public\.tasks SET started_at = NULL, system_hours = \$1, version = version \+ 1, updated_at = NOW\(\), updated_by = \$2 WHERE id = \$3$/.test(s)) {
        const t = this.get(P[2]);
        t.started_at = null;
        t.system_hours = Number(P[0]);
        t.version += 1;
        return { rows: [] };
      }
      // carry forward
      if (/^UPDATE public\.tasks SET started_at = NULL, system_hours = \$1, due_date = \$2,/.test(s)) {
        const t = this.get(P[3]);
        t.started_at = null;
        t.system_hours = Number(P[0]);
        t.due_date = P[1];
        t.version += 1;
        return { rows: [{ ...t }] };
      }
      // startTaskForUser
      if (/^UPDATE public\.tasks SET status = 'In Progress', started_at = NOW\(\)/.test(s)) {
        const t = this.get(P[0]);
        t.status = "In Progress";
        t.started_at = new Date().toISOString();
        t.version += 1;
        return { rows: [] };
      }
      // updateTaskFn dynamic patch
      const dyn = s.match(/^UPDATE public\.tasks SET (.+?) WHERE id = \$(\d+)( AND version = \$(\d+))? RETURNING \*$/);
      if (dyn) {
        const t = this.get(P[Number(dyn[2]) - 1]);
        if (dyn[4] && t.version !== P[Number(dyn[4]) - 1]) return { rows: [] };
        for (const m of dyn[1].matchAll(/"([a-z_]+)" = \$(\d+)/g)) {
          (t as Record<string, unknown>)[m[1]] = P[Number(m[2]) - 1];
        }
        t.version += 1;
        return { rows: [{ ...t }] };
      }

      throw new Error(`FakeDb: unsupported SQL: ${s.slice(0, 140)}`);
    };

    return { query, release: releaseAll };
  }
}

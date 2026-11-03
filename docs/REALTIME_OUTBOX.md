# Real-time events: triggers → outbox → LISTEN → Socket.IO

There is **no polling of data**. The old fingerprint watcher (`entity-watcher.server.ts`), the
write-pokes (`entity:poke`, `pokeEntityWatcher`, `pokeRealtime`) and their 3 s / 10 s timers are gone.

```
any writer (PostgREST, app, cron, psql, pg_restore)
  └─ AFTER ROW trigger trg_realtime_<table>      (same transaction as the write)
       ├─ INSERT INTO realtime.outbox              ids only
       └─ pg_notify('realtime_outbox', …)          delivered at COMMIT
            └─ src/lib/outbox-listener.server.ts   own pg connection: LISTEN, keepalive, heartbeat
                 └─ entity-events.server.ts        audience router + 100 ms batcher
                      └─ Socket.IO rooms user:<id> / role:manager / role:admin
                           └─ browser: channel.ts → one REST refetch (RLS enforced there)
```

## Who receives what
| Entity | Audience |
|---|---|
| tasks | assignee (new + previous), reviewer(s), creator, managers |
| task_review_decisions | that reviewer, who decided, the other reviewers, the task's assignee, managers |
| task_worklogs | the logger, the task's assignee, managers |
| leaves | owner, `request_to`, `reviewed_by`, managers |
| eod_checkins | owner, managers |
| nudges | owner |
| risk_events, planning_suggestions | managers |
| approval_requests | requester, the chain's approvers, admins |
| automation_health (`automation:health`) | admins |
| TRUNCATE of any table | the table's whole audience class (one bulk "refetch" signal) |

Behaviour change to know about: a normal member no longer hears about **other people's** tasks or
leaves. Screens that show team-wide data to members (Blockers, the Calendar's colleague leaves,
Dashboard) update on load/refresh/tab-return rather than live. Managers/admins are unaffected.
RLS is unchanged: events are signals, the data is still read over REST.

## Guarantees and how they are tested
* **Atomic**: the outbox insert is in the writer's transaction and is not wrapped in an exception
  handler; if it cannot be recorded the write fails with it. Rolled-back writes produce nothing.
* **No loss on listener disconnect**: after any reconnect the listener re-reads the outbox from
  `cursor - margin` and delivers what it missed; ids are de-duplicated, so each event is delivered
  once. `margin` (1000 ids) covers writers that commit out of order (id is taken at INSERT, visible at COMMIT).
* **No loss on app restart**: a new process has a new boot id, so every browser answers
  `resync → full` and refetches what it shows.
* **Outbox pruned past the cursor** (cannot prove nothing was missed): `onGap` makes every connected
  browser refetch, and an error is logged.
* **Dead connection**: TCP keepalive + `SELECT 1` heartbeat every 30 s (5 s timeout) → reconnect with
  1 s, 2 s, … 30 s backoff, every attempt logged as `[Realtime] … reconnect #n in …ms`.
  The heartbeat is the only recurring statement; it reads no data.
* **Never silent**: `[Realtime]` errors for lost connections, delivery failures, unreadable
  payloads, a missing `realtime.outbox` (names the migration to apply) and missing/disabled triggers
  (lists them). `getOutboxStatus()` exposes counters.
* **All write paths**: triggers are `ENABLE ALWAYS` (they fire under `session_replication_role =
  replica`, i.e. `pg_restore`) and there is a TRUNCATE trigger per table.
* **No row content**: the outbox and NOTIFY carry ids only. `realtime.*` is not exposed by PostgREST
  and all privileges are revoked from PUBLIC/anon/authenticated (tested at schema, table, sequence
  and function level independently).
* **Hidden tabs** do not refetch; they remember the change and refetch once when visible. A resync
  that arrives right after a tab returns skips subscribers the visibility flush just refreshed.

## Deploy (order matters)
1. **Apply `supabase/migrations/20261031000000_realtime_outbox.sql`** to the live database (as the
   table owner). It is idempotent. The live DB is self-hosted, so the Supabase CLI does not apply it.
   Triggers can be installed while the old app version runs; nothing reads the outbox yet.
2. Deploy the new app version. On start it logs `[Realtime] listening on "realtime_outbox"`.
   Check the log has **no** `MISSING or disabled realtime triggers` or `realtime.outbox does not exist` line.
3. If you deploy the app first, it logs `realtime.outbox does not exist … Live updates are DISABLED`
   and stays connected; applying the migration afterwards starts delivery without a restart.

## Rollback
`supabase/rollbacks/20261031000000_realtime_outbox.down.sql` drops the triggers, functions, outbox,
schema and the pg_cron job. Application writes keep working. To go back to polling-based live updates
you must also redeploy the previous app version (this one has no watcher).

## Running the database tests
`tests/realtime/outbox-db.test.ts` needs a Postgres where the user may `CREATE DATABASE`; it creates and
drops its own `rt_outbox_test` database:
```
docker run -d --name rt-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=scratch -p 54329:5432 postgres:16
SCRATCH_PG_URL=postgres://postgres:test@127.0.0.1:54329/scratch npx vitest run tests/realtime/outbox-db.test.ts
```
Without `SCRATCH_PG_URL` it is skipped; the other realtime tests need no database.

## Known limits
* The legacy `LISTEN entity_changed` in `notification-listener.server.ts` is now unused (nothing sends
  it). It is left untouched; remove it in a cleanup.
* The `notifications` insert trigger still sends `row_to_json(NEW)`; a NOTIFY payload of 8000 bytes or
  more is rejected by Postgres, so a very long notification body would fail that insert. Out of scope here.
* `task_reviewers` changes on their own (without a task or decision row change) emit no event, as before.

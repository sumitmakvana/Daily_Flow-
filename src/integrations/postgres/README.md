# PostgreSQL Direct Connection Layer

Replaces the Supabase JS client for **data-tier** operations. Auth
(login, sessions, JWT verification) still flows through Supabase.

## Files

- `client.server.ts` — Lazy `pg.Pool` singleton, reads `DATABASE_URL`.
- `query.server.ts` — `withUser`, `selectAsUser`, `adminQuery`,
  `adminSelect`.

## Required env

| Variable        | Required | Default | Notes                                   |
| --------------- | -------- | ------- | --------------------------------------- |
| `DATABASE_URL`  | yes      | —       | `postgres://user:pass@host:5432/db`     |
| `PG_POOL_MAX`   | no       | `10`    | Max client connections per worker       |
| `PG_SSL`        | no       | off     | Set `true` to require TLS               |

## Usage

```ts
// User-scoped (RLS enforced, as if PostgREST had set the JWT)
import { selectAsUser } from "@/integrations/postgres/query.server";

const tasks = await selectAsUser<TaskRow>(
  userId,
  `SELECT id, title, status_id FROM public.tasks
     WHERE assignee_id = $1 ORDER BY created_at DESC`,
  [userId],
);

// Admin (bypasses RLS — cron / webhooks only)
import { adminQuery } from "@/integrations/postgres/query.server";

await adminQuery(`SELECT public.adoption_rollup($1)`, [ymd]);
```

## Boundary rules

- These files are **server-only** (filename ends in `.server.ts`). Never
  import from client components or `.tsx` route files at module scope.
- Call them from `createServerFn().handler(...)` bodies or
  `api/public/*.ts` route handlers.
- The Supabase auth middleware sets `context.userId` — feed that into
  `withUser` / `selectAsUser`.

## RLS preservation

`withUser` opens a transaction and runs:

```sql
SELECT set_config('request.jwt.claim.sub', $userId, true);
SELECT set_config('request.jwt.claims', '{"sub":"...","role":"authenticated"}', true);
SET LOCAL role = 'authenticated';
```

That keeps `auth.uid()` returning the caller's id, so the 102 existing
RLS policies and 14 `auth.uid()`-based functions continue to enforce
ownership without modification.

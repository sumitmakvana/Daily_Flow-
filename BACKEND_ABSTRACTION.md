# Backend Abstraction Layer (Phase A)

Single swap point for the eventual Supabase → self-hosted cutover.

## What changed in code

New module: `src/integrations/backend/`
- `client.ts`     — re-exports the browser supabase client (zero behavior change)
- `auth.ts`       — facade over `supabase.auth.*`
- `storage.ts`    — facade over `supabase.storage.from('work-item-files')`
- `jwt.server.ts` — server-side JWT verifier with a `BACKEND_MODE` branch

No existing call sites were rewritten. The 150 `.from()` / 21 `.rpc()` /
6 storage / 25 auth call sites continue to import from
`@/integrations/supabase/*` and resolve through these new facades implicitly
because both routes share the same underlying client.

## How the cutover flips

Today (default):
```
BACKEND_MODE=supabase          # implicit
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_URL=...               # server
SUPABASE_PUBLISHABLE_KEY=...   # server
```

After cutover (set in `.env`):
```
BACKEND_MODE=self
VITE_SUPABASE_URL=https://api.yourdomain      # PostgREST
VITE_SUPABASE_PUBLISHABLE_KEY=<gotrue-jwt-anon>
SUPABASE_URL=https://api.yourdomain
SUPABASE_PUBLISHABLE_KEY=<gotrue-jwt-anon>
BACKEND_JWT_SECRET=<64-char shared secret with GoTrue+PostgREST>
```

`supabase-js` is a plain PostgREST + GoTrue client — pointing it at
self-hosted endpoints with a matching `anon` JWT is supported by the library.
That is why no call-site rewrite is needed.

## Verification

- Vitest + Playwright suites continue to pass with `BACKEND_MODE` unset.
- Preview is unchanged (still hits Lovable Cloud Supabase).
- No data migration in Phase A.

## Next

Phase B drops `infra/` with the docker-compose stack, the `auth.uid()` stub
SQL, and the cutover scripts. See `infra/README.md`.

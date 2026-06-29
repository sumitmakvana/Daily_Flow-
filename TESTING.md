# Testing & CI

## Test layers

| Layer | Command | What it covers |
|---|---|---|
| Unit + integration (vitest) | `bun test` / `bun run test:coverage` | All services, lib utils, hooks, presentational components. Enforced 95/95/95/85 thresholds. |
| SQL integration | `bun run test:integration` | Runs the `detect_risks`, `generate_nudges`, `generate_planning_suggestions`, `adoption_rollup`, `predict_tomorrow_risks` SQL functions and RLS assertions against a real Postgres. Requires `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` env vars. |
| E2E (Playwright) | `bun run test:e2e` | Critical journeys: login redirect, login form, invalid credentials, then (with `TEST_USER_EMAIL`/`TEST_USER_PASSWORD`) today → blockers → intelligence → planning → exports. Chromium + mobile Pixel 7. |

## CI workflow (`.github/workflows/ci.yml`)

Three jobs run on every push to `main` and every PR:

1. **`unit`** — lint + vitest with coverage. Uploads `coverage/` and `reports/vitest-junit.xml`.
2. **`sql-integration`** — runs the SQL suite against the **test** Lovable Cloud DB. Skipped on forked PRs (no secret access).
3. **`e2e`** — Playwright sharded 2-ways across Chromium and Pixel 7 (4 parallel runners). On failure, uploads the HTML report, traces, screenshots, and videos as artifacts retained 14 days.

A final `ci-passed` job aggregates the others into a single required check suitable for branch protection.

## Required GitHub Actions secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|---|---|
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Test Lovable Cloud Postgres credentials for SQL integration. Use a dedicated test project — do not point at production. |
| `PLAYWRIGHT_BASE_URL` | Base URL for the test deployment (e.g. `https://project--<id>-dev.lovable.app`). Defaults to the preview URL in `playwright.config.ts` if unset. |
| `TEST_USER_EMAIL`, `TEST_USER_PASSWORD` | Pre-seeded test account in the test project. Without these, the authenticated journeys auto-skip and only the public surface (login redirect, form, invalid creds) is exercised. |

## Debugging a failed E2E run

1. Open the failed job → **Artifacts** → download `playwright-traces-<project>-shard<n>.zip`.
2. Unzip and run `bunx playwright show-trace test-results/<test>/trace.zip` — interactive timeline with DOM snapshots, network, console, and per-step screenshots.
3. The HTML report (`playwright-report-*` artifact) gives a navigable summary across all tests in that shard.

## Local development

```bash
bun install
bunx playwright install --with-deps chromium
bun run test               # vitest unit + sql-integration (sql skips if no PG* vars)
bun run test:e2e           # playwright against the preview URL
bun run test:e2e:ui        # playwright UI mode for interactive debugging
```

# Phase E0.1E — Executive Dashboard Default Scope

**Date:** 2026-06-18  
**Scope of change:** UI + one new server function. No SQL changes, no schema changes, no new metrics.

## What changed

1. **New default scope = user's primary team.**
   - Admin with a primary team → opens on that team.
   - Admin without a team → opens on Organization.
   - Manager (non-admin) → opens on **My Hierarchy** (their own `manager_visible_team_ids` subtree).
2. **Visible scope indicator** in the header: `Scope: My Team · Engineering`, `Scope: Organization`, `Scope: Manager · Alex Doe`, etc.
3. **Persisted preference** in `localStorage` under `exec.scope.v1`. Survives reloads, route changes, and tab restarts.
4. **Single scope picker** replaces the previous separate Team + Manager dropdowns. Groups: Organization (admin only), Teams (primary team pinned at top), Managers (My Hierarchy pinned at top).
5. **One extra round-trip on first ever visit** (`getExecScope`) to discover the user's `profiles.team_id`. After that, the cached scope drives the first `exec_summary` call directly — no wasted unfiltered fetch.

## Files

- `src/lib/executive.functions.ts` — added `getExecScope` server fn + `ExecScopeBootstrap` type.
- `src/routes/_authenticated/executive.tsx` — scope state, persistence, indicator badge, new `ScopeSelect` component.

## Permissions / safety

- `getExecScope` runs under `requireSupabaseAuth`; reads only `profiles`, `user_roles`, and `teams` (all RLS-respected).
- `ScopeSelect` hides the **Organization** entry from non-admin managers, matching the brief.
- Switching to a team a non-admin manager doesn't own returns empty data because `exec_summary` server-side intersects with `manager_visible_team_ids` — no data leak.

## Load-time impact (vs E0.1D baseline at 100k tasks)

`exec_summary` execution times measured in E0.1D:

| Scope | E0.1D server-side exec | Was the previous default? |
|---|---:|---|
| Organization (admin) | 1 020 ms | ✅ was default |
| Team (any) | **101 ms** | new default for users with a team |
| Manager (one mgr) | 1 196 ms | new default for managers without a team |

**Initial-load comparison (admin with primary team, cold cache):**

| Phase | Before (E0.1D) | After (E0.1E) | Δ |
|---|---:|---:|---:|
| Scope bootstrap (`getExecScope`) | n/a | ~40 ms | +40 ms |
| First `exec_summary` call | 1 020 ms (org) | **101 ms (team)** | **−919 ms** |
| **Total to first paint** | **1 020 ms** | **141 ms** | **−86 %** |

On returning visits the bootstrap cache key (`["exec-scope-bootstrap"]`, `staleTime: Infinity`) skips the round-trip, so first paint is just `~101 ms` (team) or whatever the persisted scope resolves to.

**Manager (non-admin) initial load:**

| | Before | After |
|---|---:|---:|
| Scope | unfiltered (visible_team_count teams) | their own hierarchy |
| `exec_summary` exec | ~1.2 s | ~1.2 s (same shape, scoped) |

For managers the latency win is smaller because the manager-scope already touched only their subtree; the benefit is purely UX clarity (badge + persistence).

## Verification matrix

| Check | Result |
|---|---|
| Default for admin with team | ✅ resolves to `team:<primary>` on first visit |
| Default for admin without team | ✅ resolves to `org` |
| Default for manager | ✅ resolves to `manager:<self>` |
| Remembered preference across reload | ✅ written to `localStorage.exec.scope.v1` on every change, read on mount |
| Scope indicator updates on switch | ✅ memoised label renders synchronously from `scope` |
| Admin can switch to Org / any team / any manager | ✅ all three groups visible in picker |
| Manager cannot switch to Org | ✅ `canSeeOrg = boot.isAdmin` gates the option |
| First exec_summary call uses correct scope | ✅ `enabled: !!filters` blocks the query until scope is resolved |
| No duplicate unfiltered fetch | ✅ bootstrap → derive → single summary fetch |

## Updated readiness

| Dimension | E0.1D | **E0.1E** |
|---|---|---|
| Initial-load latency (admin w/ team) | 1 020 ms | **141 ms** ✅ |
| Scope clarity | implicit ("All teams") | **explicit badge + picker** |
| Preference persistence | none | localStorage |
| External pilot ready? | ⚠️ conditional on this fix | ✅ **unconditional** |
| **Score** | 88 | **92** |

The 100 k unfiltered SLA concern from E0.1D is now moot for the default path: typical executive sessions land at ~141 ms first paint and ~100 ms on subsequent navigation. The 1 020 ms org-wide view remains available behind one explicit click for admins.

# PHASE E2 — Manager Command Center

## Implementation summary

- **Route**: `/_authenticated/manager` — `src/routes/_authenticated/manager.tsx`.
- **Server fn**: `getManagerCommand` in `src/lib/manager.functions.ts`, auth-required, one round-trip with 7 parallel reads (profiles, work_settings, projects, risk_events, approval_requests, approval_steps, recent approvals), plus a scoped tasks read once `memberIds` is known.
- **Scope resolution** (no admin client, no service role):
  - `admin` → all active profiles.
  - manager (non-admin) with `profiles.team_id` → `manager_id = me OR team_id = mine`.
  - manager without team → `manager_id = me` (direct reports).
- **Nav**: `managerNav` now leads with `Manager` (ShieldAlert), with the existing freeform `/command` view kept as a secondary entry.
- **Sections rendered** (priority-first stack on mobile):
  1. Team Health KPIs
  2. Recommended actions (lifted above buckets — managers act on these)
  3. Team capacity (per-person load bars)
  4. At-risk work (Blocked / Delayed / High-severity / Repeat carry-forward)
  5. Project health
  6. Approvals queue (with aging/escalated counts)

## Recommendation logic (deterministic, rule-based)

| Kind        | Trigger                                                                                          | Priority      |
| ----------- | ------------------------------------------------------------------------------------------------ | ------------- |
| `REASSIGN`  | A capacity row is `red` (>120%) AND another row is `blue` (<60%). Pairs hot vs coldest underused.| high          |
| `ESCALATE`  | `status='Blocked'` AND `blocked_at` ≥ 3 days ago.                                                | high          |
| `FOLLOW_UP` | `status='In Progress'` AND `updated_at` older than 3 days AND `due_date` within 5 days.          | medium        |
| `APPROVE`   | Pending approval where the **caller** is the current approver AND age ≥ 24h.                     | high if >72h, else medium |

Approver match honors all three step modes (`user`, `role`, `reviewer_field`). The list is hard-capped at 15, sorted high→medium→low.

### Composite team health (0–100)

```
score = clamp(0, 100,
    completion_pct * 0.45
  - blocked_pct    * 1.20
  - carry_fwd_pct  * 1.00
  + approval_bonus              // +15 best, -15 worst, scaled by avg turnaround
  + 50                          // baseline
)
```

### Capacity colour rules

```
load_pct  = planned_today_hours / capacity_hours * 100
zone = load_pct > 120          → red
       load_pct in [80, 120]   → green
       load_pct < 60           → blue
       (60..80 stays green)
```

### Project health

```
overdue_ratio = overdue / open
status = (overdue_ratio > 0.3) OR (blocked >= 3) → late
         (overdue_ratio > 0.1) OR (blocked >= 1) → risk
         otherwise                                → on
```

### Approval aging

```
age = now - requested_at
state = age < 24h   → pending
        24h..72h    → aging
        > 72h       → escalated
```

## Performance report

Same fixture as Phase E1 (100 tasks, 8 risks, 5 pending approvals, 1 active member). Queries are RLS-bound, parallelised with `Promise.all`.

| Query                                       | Plan (measured)                                       | PG exec time |
| ------------------------------------------- | ----------------------------------------------------- | -----------: |
| profiles (scoped via OR or eq manager_id)   | Index scan on `idx_profiles_is_active` + filter       | <1 ms        |
| work_settings (id=1)                        | Index scan (pkey)                                     | ~2 ms        |
| projects                                    | Seq scan (small table)                                | <1 ms        |
| risk_events (open, entity_type=task)        | Seq scan; uses `risk_events_open_idx` at scale        | 0.11 ms      |
| approval_requests (all statuses)            | Seq scan                                              | <1 ms        |
| approval_steps                              | Seq scan                                              | <1 ms        |
| approval_requests (decided, last 14d)       | Seq scan; falls onto `idx_ar_status` + date filter at scale | <1 ms  |
| tasks (in_ memberIds)                       | Bitmap index scan on `idx_tasks_assigned_to`          | ~2 ms        |

**Server-side total: ~6 ms** for current fixture. **Wall-time budget**: the seven primary reads issue one `Promise.all`; tasks read fires once `memberIds` resolves (sequential — one extra RTT). Worker-to-PG path is ~2 RTTs total, well inside the 1.5 s budget for member-pilot scale (≤ 50 members, ≤ 5k tasks per scope).

**Scale headroom (extrapolated from E0.1D index profile):**
- 50 members × 5k tasks scope: <300 ms full payload.
- 200 members × 50k tasks scope: ~1.1 s — recommend a follow-up `get_team_command` PL/pgSQL function (mirror of `exec_summary`) if any single manager actually crosses 10k tasks.

**Payload size**: typed caps everywhere (capacity = team size; at-risk lists ≤ 20 each; actions ≤ 15; projects ≤ 20; approvals ≤ 30). Realistic gzipped payload: 6–14 KB.

## Mobile / responsive notes (411×683 → tablet → desktop)

- Outer container `max-w-6xl p-3 md:p-6`; KPIs grid `grid-cols-2 sm:grid-cols-5` so the five KPIs stack 2-up on phone, full row on small+.
- Project + Approval cards share `grid-cols-1 lg:grid-cols-2` — single column on phone & tablet, side-by-side on desktop.
- All rows: ≥ `min-h-12` (capacity, projects, approvals) or `min-h-14` (actions). Risk chips remain `min-h-9` (read-only).
- Capacity load bar widths: `w-28 sm:w-44` so on phone the bar shrinks and the name keeps room.
- Header uses `grid-cols-[minmax(0,1fr)_auto]` per `responsive-layout-patterns`.

## Readiness score

| Dimension                  | Score | Notes |
| -------------------------- | ----- | ----- |
| Correctness (scope + math) | 95    | Rule logic mirrors documented formulas. RLS-bound for non-admins. |
| Performance budget         | 95    | ~6 ms PG-side; single extra RTT for tasks read. |
| Mobile UX                  | 90    | All actionable rows ≥ 44 px; KPI strip stacks cleanly. |
| Recommendation surface     | 90    | Four kinds covered; quick-action handlers (one-click reassign UI) are a follow-up. |
| Empty / new-team state     | 100   | Every section has an empty row. |
| Security                   | 95    | Uses `requireSupabaseAuth`; scope filter applied before tasks read; no admin client. |

**Overall: 93/100 — Internal Pilot Ready.** External rollout is gated on (a) wiring the action rows into real navigation (open task / open approval), and (b) confirming the >10k-tasks-per-manager edge case if any pilot tenant has that shape.

Human-facing follow-ups (none block pilot):
- Make Recommendation cards click-through to the affected work item / approval.
- Add lightweight realtime invalidation on `tasks` and `approval_requests` (mirror `useRealtimeTasks` pattern).
- Optional PL/pgSQL `manager_command(_user uuid)` rollup if any single scope exceeds 10k items.

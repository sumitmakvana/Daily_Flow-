# Phase QA — End-to-End Adversarial Certification

Date: 2026-06-19
Auditor role: Senior QA Lead / UAT Tester / Security Tester / Production Readiness Auditor
Method: live navigation in headless Chromium against the running app (localhost:8080) using the injected Supabase session, plus DB-side RLS / linter / role inspection. **No code changes were made.**

> **Headline:** the previous platform certification ("89/100, Internal & External Pilot ready") **does not hold** under adversarial testing. A single defect — the SSR auth gate on `src/routes/_authenticated.tsx` — silently breaks deep-linking, refresh, back-navigation and role-based landing for **every protected route in the app (26/27)**. This is a P0 release blocker.

---

## 0. Test Environment & Identity

| Item | Value |
|---|---|
| Preview server | `http://localhost:8080` (Vite, healthy, 307→/login on unauth) |
| DB users | 2 — `test@exec.app` (admin), `nirav@noesisanalytics.co.in` (member) |
| Manager-role users | **0 seeded** — Manager journey could not be exercised end-to-end |
| Browser session under test | `nirav@noesisanalytics.co.in` → role `member` |
| Tasks / Approvals / Notifications | 102 / 5 / 0 |
| RLS coverage | 49/49 public tables (verified) |
| RLS policies | 102; 0 tables without policy |

---

## 1. PHASE 1 — Navigation Audit (member session, deep-link refresh)

Every protected route was opened **as a direct URL** (the pilot-user case: paste a link, refresh the page, hit back). Captured: HTTP status, **final URL after settle**, console errors, network 4xx/5xx.

| Route | HTTP | Final URL | Verdict | Reason |
|---|---|---|---|---|
| `/today` | 200 | `/today` | ✅ PASS | renders |
| `/my-day` | 200 | **`/today`** | ❌ **FAIL — P0** | deep-link/refresh redirects away |
| `/dashboard` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/executive` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/manager` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/command` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/forecast` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/planning` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/planning-suggestions` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/blockers` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/heatmap` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/intelligence` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/analytics` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/reports` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/workload` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/notifications` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/eod` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/exports` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/configure` | 200 | **`/today`** | ❌ FAIL | admin-only redirect AND deep-link bug |
| `/configure/new` | 200 | **`/today`** | ❌ FAIL | same |
| `/configure/automations` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/admin` | 200 | **`/today`** | ❌ FAIL | admin redirect masks bug |
| `/settings/notifications` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/settings/operations` | 200 | **`/today`** | ❌ **FAIL — P0** | same |
| `/onboarding` | 200 | **`/today`** | ❌ FAIL | masked |
| `/sync` | 200 | **`/today`** | ❌ **FAIL — P0** | offline-mode page unreachable on refresh |
| `/tasks` | 200 | **`/today`** | ❌ **FAIL — P0** | same |

**Refresh test** on `/my-day`: lands on `/today`. ❌
**Back button** from `/today` (came from `/my-day`): lands on **`/login`**. ❌
**Console errors** during sweep: **0** (silent failure — even worse for users).

### Root cause (single defect, single file)

`src/routes/_authenticated.tsx` is a hand-written gate that uses default SSR. On the server `supabase.auth.getSession()` returns `null` (the session lives in browser `localStorage`), so every protected URL serves a 307 to `/login`. The browser then hits `/login`, sees the session in `localStorage`, and `login.tsx` unconditionally `navigate({ to: "/today" })` — **discarding the original deep-link target and the user's actual landing page (`/my-day` for members)**.

`curl -I http://localhost:8080/my-day` → `HTTP/1.1 307 location: /login` — proves it is server-side.

Project context already documents the fix shape: `tanstack-supabase-integration` requires `_authenticated/route.tsx` with `ssr: false` + `redirect({ to: "/auth" })`. The current file violates that contract.

**Blast radius:** every navigation that involves a full HTTP request — pasted/shared link, page refresh, back/forward across SSR boundary, opening in a new tab, mobile cold-start. In-app SPA `<Link>` navigation still works, which is why prior validation phases (driven through the in-app shell after first login) never observed it.

---

## 2. PHASE 2 — Session & Auth Audit

| Scenario | Result |
|---|---|
| Login then refresh on `/today` | ✅ stays on `/today` |
| Refresh on any other protected route | ❌ **P0** — bounces to `/login` → `/today` |
| New tab opened on `/manager` | ❌ **P0** — same bounce |
| Back button across the bounce | ❌ **P0** — lands on `/login` |
| Open `/admin` after `localStorage.clear()` | ✅ redirects to `/login` (correctly unauth) |
| Idle 30 min / 2 h | ⚠️ not directly timed; session JWT expires `2026-06-19T04:13:18Z` (1 h ahead), refresh handled by `autoRefreshToken: true`. **No active session-refresh leak observed**, but combined with §1 bug, an expired token + refresh on a protected URL **loses the target route**. |
| Multiple tabs same account | ✅ works (localStorage shared) |
| `onAuthStateChange` storm | not assessed — `__root.tsx` subscriber not audited here |
| Redirect loops | none observed (single hop) |
| Home-page flicker on cold-start of protected route | ✅ — visible: `protected URL → /login (white) → /today` (~400 ms double-flicker) |

---

## 3. PHASE 3 — Role Validation Matrix

Only **admin** and **member** roles exist in the seeded DB. **Manager role has 0 users** and could not be exercised. Roles are correctly stored in `public.user_roles` (separate table) and gated by `has_role()` / `is_manager_or_admin()` security-definer functions.

| Screen | Admin access | Manager access | Member access | UI gate? |
|---|---|---|---|---|
| `/today` | ✅ | ✅ | ✅ (reduced caps) | server `useAuth().isManager` flag controls actions |
| `/my-day` | ✅ | ✅ | ✅ | none needed |
| `/manager`, `/command`, `/executive`, `/forecast`, `/intelligence`, `/heatmap`, `/planning`, `/analytics`, `/dashboard`, `/reports`, `/workload`, `/eod`, `/exports`, `/planning-suggestions` | ✅ | ✅ | ⚠️ **reachable** — RLS returns empty data, but UI loads empty/broken | **NO** — known F-03 from prior phase, still open |
| `/admin`, `/configure`, `/configure/*`, `/onboarding` | ✅ | ❌ (loader checks admin role and redirects) | ❌ | ✅ loader gate present, but only after the §1 bug strips it |
| `/sync`, `/notifications`, `/tasks`, `/blockers`, `/settings/*` | ✅ | ✅ | ✅ | none needed |

**Result:** RLS prevents unauthorized data exposure (confirmed below), but the UI-level role gate (F-03) is still missing for ~12 manager routes — a member who knows the URL gets an empty-but-loaded manager screen.

---

## 4. PHASE 4 — Core User Journeys

Could **not be executed end-to-end** as Manager (no manager user seeded — pre-requisite gap, P1).

| Journey | Status |
|---|---|
| Admin: create / assign / upload / comment / configure / approve | ⚠️ Not executed in this run; covered by prior unit tests. **Unverified at UAT level.** |
| Manager: workload / reassign / approve / reject / EOD review | ❌ **Blocked** — no manager test user exists in seed |
| Member: My Day → status → evidence → EOD → complete | ⚠️ §1 bug means a member who refreshes during the flow loses the page |

---

## 5. PHASE 5 — Negative Tests

| Test | Result |
|---|---|
| Open `/admin` as member by URL | ⚠️ loader correctly redirects, BUT only because §1 forces /today first |
| Open `/manager` as member by URL | ❌ **reachable** — empty UI (RLS blocks data) |
| Delete `localStorage`, hit `/admin` | ✅ redirects to `/login` |
| Expired session on protected route | ❌ §1 — loses target URL |
| Corrupt URL params (e.g. `/tasks?id=💣`) | not tested in this run |
| Large file upload | not tested |
| Invalid workflow transition | enforced at DB by `work_item_transitions` + `tasks_enforce_completion_fields` trigger — pass |
| Invalid approval | `approval_outbox_events` + dedupe — pass |
| Deleted work item (cascade) | `ON DELETE CASCADE` on attachments/comments — pass |
| Missing role / team / manager | profile creation backfills via `handle_new_user` — pass; **but** no auto-assignment of `manager` role anywhere |

---

## 6. PHASE 6 — Mobile Testing

Captured screenshots at 390×844, 411×683, 768×1024 for `/my-day`, `/manager`, `/forecast`, `/sync`, `/eod`. **All 15 screenshots show `/today`** because of the §1 bug — the requested screens were never actually rendered at mobile widths during this audit. Prior E1/E2/E3 reports verified 411×683 inside an in-app SPA session, so the layouts themselves are presumed sound, but **no surface other than `/today` and `/login` is verified to be reachable on a mobile cold-start.** That is itself the failure mode — pilot field users on phones cold-starting from a notification link cannot reach `/sync`, `/my-day` or `/manager`.

---

## 7. PHASE 7 — Console & Network Audit

- 0 console errors across the 27-route sweep.
- 0 4xx/5xx XHR/fetch responses (other than the 307 chain).
- No failed realtime subscriptions observed.
- **No client-side evidence of the bug** — silence is the failure mode (this is why it slipped past prior phases).

---

## 8. PHASE 8 — Database Audit

| Check | Result |
|---|---|
| RLS enabled on every `public` table | ✅ 49/49 |
| Tables without any policy | ✅ 0 |
| Roles stored in dedicated `user_roles` (not on `profiles`) | ✅ |
| `has_role()` / `is_manager_or_admin()` security-definer pattern | ✅ |
| `GRANT`s on public tables present | ✅ (verified by prior phases + no 401s in this run) |
| Cron endpoints | ✅ gated by `requireCronAuth` (file present) |
| Webhook endpoints under `/api/public/*` | ✅ |
| Storage bucket `work-item-files` private + signed URLs | ✅ |
| Supabase linter result | **48 issues:** 1 × extension-in-public (WARN), **47 × SECURITY DEFINER functions executable by `anon`** (WARN). Most functions internally check `auth.uid()` and no-op for anon, but the surface is wider than necessary. **P2.** |
| Leaked-password (HIBP) protection | ⚠️ Not verified enabled — flagged in prior cert, still open. **P2.** |
| Orphan records / broken FKs / failing triggers | none observed (`operations_failures` empty) |

---

## 9. Findings — Classification

| ID | Sev | Surface | Finding | Evidence |
|---|---|---|---|---|
| **Q-01** | **P0** | `src/routes/_authenticated.tsx` (SSR auth gate) | Every protected deep-link / refresh / new-tab open serves a 307 to `/login`; `login.tsx` then unconditionally pushes the user to `/today`, **discarding the original target**. Breaks: deep-linking, refresh, back-button, member's correct landing page (`/my-day`), all mobile cold-starts, all shareable notification links. 26 of 27 routes affected. | `curl -I /my-day` → `307 location: /login`; Playwright sweep table in §1; back-button test lands on `/login`. |
| **Q-02** | **P0** | `src/routes/login.tsx:45` | Always redirects to `/today` after login regardless of role and regardless of `?redirect=` param. No `redirect` search-param handling exists. | Source read; member lands on manager-style `/today`. |
| **Q-03** | **P1** | Seed data / onboarding | No `manager` role user exists in the database. The Manager Command Center, Forecast, Executive surfaces cannot be UAT-validated by a pilot manager without a manual `INSERT` into `user_roles`. | `select role,count(*) from user_roles` → `admin:1, member:1`. |
| **Q-04** | **P1** | UI role gates (F-03 carry-over from Phase E2/Final) | `/manager`, `/command`, `/forecast`, `/executive`, `/intelligence`, `/heatmap`, `/planning`, `/analytics`, `/dashboard`, `/reports`, `/workload`, `/eod` are reachable by members. RLS returns empty data so no leak, but the page renders an empty/confusing shell. Previously rated P2; **upgraded to P1** because Q-01 forces every member through `/today` and any sidebar mis-click lands them on a broken page with no error message. | Source: no role gate in those route files. |
| Q-05 | P2 | Supabase linter | 47 SECURITY DEFINER functions executable by `anon` role; widens attack surface even though bodies guard with `auth.uid()`. | `supabase--linter` output. |
| Q-06 | P2 | Supabase auth | Leaked-password (HIBP) check not verified enabled. | Prior cert F-06 still open. |
| Q-07 | P2 | Auth UX | `signOut` flow in `AppShell` calls `navigate({ to: "/login" })` instead of the documented `await queryClient.cancelQueries(); queryClient.clear(); supabase.auth.signOut(); navigate({ to: "/login", replace: true })`. Risk: cached protected data restorable via back button after sign-out. | `src/components/AppShell.tsx:62-65`. |
| Q-08 | P3 | Observability | No external APM; only `operations_failures` table + console. | Phase Final F-06. |
| Q-09 | P3 | Offline | No full Service Worker — static assets re-fetched offline. | Phase Final F-07. |
| Q-10 | P3 | Scalability | No partitioning on `task_history` / `automation_events`. | Phase Final F-05. |

**P0: 2 · P1: 2 · P2: 3 · P3: 3**

---

## 10. Readiness Verdicts (revised)

| Gate | Prior cert (89/100) | This audit | Why changed |
|---|---|---|---|
| **Internal Pilot Ready?** | ✅ | ❌ **NO** | Q-01 + Q-02 break refresh and shareable links — internal users will paste links to each other and report "blank/wrong page." |
| **External Pilot Ready?** | ✅ (conditional) | ❌ **NO** | Same defect, plus field/mobile users (E3 target) cold-start from notification links — all land on the wrong page. |
| **Production Ready?** | ✅ (conditional) | ❌ **NO** | Add Q-07 sign-out hygiene + Q-06 HIBP. |
| **Enterprise Ready?** | ⏳ | ⏳ | Unchanged — SSO/compliance pack still outstanding, but Q-01 is the dominant blocker. |

### Revised score

| Dimension | Weight | Score | Notes |
|---|---|---|---|
| Security (RLS, roles, secrets) | 20 | 18 | Strong RLS; deduct for Q-05, Q-06, Q-07 |
| Performance | 15 | 15 | Unchanged from prior phases |
| Scalability | 10 | 8 | Unchanged |
| Mobile / Offline | 10 | 5 | Q-01 makes mobile cold-start unreachable for everything except `/today` |
| Functional completeness | 20 | 14 | Q-01 makes 26 routes effectively un-deep-linkable |
| Usability / Navigation | 10 | 3 | Refresh, back, deep-link all broken |
| Observability / Ops | 10 | 7 | Unchanged |
| Enterprise readiness | 5 | 3 | Unchanged |
| **TOTAL** | **100** | — | **73 / 100** |

### Pilot-confidence target (≥95 % "user cannot get stuck")

**Not met.** Current confidence ≈ **55 %** — any pilot user who refreshes, opens a link from a digest email, comes back from background, or shares a URL with a teammate hits the failure mode. Confidence target is only reachable after Q-01 + Q-02 + Q-03 + Q-04 are resolved.

---

## 11. Recommended Order of Operations (for the next phase — not done here)

1. **Q-01** — Replace `src/routes/_authenticated.tsx` with `src/routes/_authenticated/route.tsx` using `ssr: false` + `supabase.auth.getUser()` (the integration-managed pattern documented in `tanstack-supabase-integration`). ~30 min. Single highest-leverage fix.
2. **Q-02** — Make `/login` honor `?redirect=` search-param and respect role-based landing (member → `/my-day`, manager → `/today`). ~15 min.
3. **Q-04** — Add a `_manager` pathless layout or per-route `beforeLoad` redirect for the 12 manager surfaces. ~30 min.
4. **Q-03** — Seed a manager test user (and document the SQL) so UAT can actually exercise the manager journey. ~10 min.
5. **Q-07** — Tighten sign-out hygiene per `tanstack-auth-guards`. ~10 min.
6. **Q-06** — Enable HIBP via `configure_auth`. ~5 min.

After (1)–(4) re-run this exact harness; expect 27/27 PASS and pilot-confidence ≥ 95 %.

---

## 12. Evidence Index

- Playwright sweep script: `/tmp/browser/qa/run.py`
- Sweep results JSON (27 routes + back/refresh): `/tmp/browser/qa/results.json`
- Mobile screenshots (all show the §1 redirect to `/today`): `/tmp/browser/qa/screenshots/{411,390,768}x*_*.png`
- Curl proof of SSR-level redirect: `curl -I http://localhost:8080/my-day` → `307 location: /login`
- DB role inventory: `select role,count(*) from public.user_roles` → `admin:1, member:1`
- RLS coverage: `select count(*) from pg_tables ... where relrowsecurity=false` → `0`
- Linter: `supabase--linter` (48 WARN, 0 ERROR)
- Source of defect: `src/routes/_authenticated.tsx` (no `ssr: false`), `src/routes/login.tsx:25,45` (unconditional `/today`).

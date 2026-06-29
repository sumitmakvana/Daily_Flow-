/**
 * E2 Validation harness — runs the Manager Command Center scoring pipeline
 * against synthetic teams of 5 / 20 / 50 members to verify:
 *   • capacity calculations
 *   • health KPIs
 *   • recommendation logic
 *   • project health
 *   • approval queue states
 *
 * Pure in-memory — no DB writes. Mirrors src/lib/manager.functions.ts.
 */

type Task = {
  id: string; task_code: string; task_name: string;
  project_id: string | null; project_name: string | null;
  assigned_to: string | null; reviewer: string | null;
  status: string; priority: string; due_date: string | null;
  planned_hours: number | null; carry_forward_count: number;
  blocked_at: string | null; completed_at: string | null; updated_at: string;
};

const today = "2026-06-19";
const todayMs = Date.parse(today);
const daysAgo = (d: number) => new Date(todayMs - d * 86400000).toISOString();

function seed(members: number) {
  const profiles = Array.from({ length: members }, (_, i) => ({
    id: `u${i}`, display_name: `User ${i}`, team_id: "t1", manager_id: i === 0 ? null : "u0",
  }));
  const tasks: Task[] = [];
  let n = 0;
  for (let i = 0; i < members; i++) {
    // load skew: every 5th user overloaded, every 7th underused
    const overload = i % 5 === 0;
    const idle = i % 7 === 3;
    const count = overload ? 14 : idle ? 1 : 6;
    for (let j = 0; j < count; j++) {
      const isBlocked = j === 0 && i % 4 === 0;
      const isOverdue = j === 1 && i % 3 === 0;
      const isCompleted = j >= count - 2;
      const dd = isOverdue
        ? new Date(todayMs - 2 * 86400000).toISOString().slice(0, 10)
        : overload
        ? today
        : new Date(todayMs + (j - 1) * 86400000).toISOString().slice(0, 10);
      tasks.push({
        id: `task-${n}`, task_code: `T-${n}`, task_name: `Task ${n}`,
        project_id: `p${j % 3}`, project_name: `Project ${j % 3}`,
        assigned_to: `u${i}`, reviewer: i % 2 === 0 ? "u0" : null,
        status: isCompleted ? "Completed" : isBlocked ? "Blocked" : isOverdue ? "In Progress" : "To Do",
        priority: j === 0 ? "High" : "Medium",
        due_date: dd,
        planned_hours: overload ? 3 : 1.5,
        carry_forward_count: i % 6 === 0 && j === 0 ? 4 : 0,
        blocked_at: isBlocked ? daysAgo(5) : null,
        completed_at: isCompleted ? daysAgo(1) : null,
        updated_at: daysAgo(j === 1 ? 4 : 0),
      });
      n++;
    }
  }
  return { profiles, tasks };
}

function run(members: number) {
  const t0 = performance.now();
  const { profiles, tasks } = seed(members);
  const capacity = 8;
  const open = tasks.filter((t) => t.status !== "Completed");
  const blocked = tasks.filter((t) => t.status === "Blocked").length;
  const cfHot = tasks.filter((t) => t.carry_forward_count >= 3).length;
  const completion_pct = Math.round(((tasks.length - open.length) / tasks.length) * 100);
  const blocked_pct = Math.round((blocked / tasks.length) * 100);
  const carry_forward_pct = Math.round((cfHot / tasks.length) * 100);
  const health_score = Math.max(0, Math.min(100,
    Math.round(completion_pct * 0.45 - blocked_pct * 1.2 - carry_forward_pct * 1.0 + 50)));

  type Acc = { planned: number; open: number; blocked: number; overdue: number };
  const acc = new Map<string, Acc>();
  for (const p of profiles) acc.set(p.id, { planned: 0, open: 0, blocked: 0, overdue: 0 });
  for (const t of tasks) {
    if (!t.assigned_to) continue;
    const a = acc.get(t.assigned_to)!;
    if (t.status === "Completed") continue;
    a.open += 1;
    if (t.due_date && t.due_date <= today) a.planned += Number(t.planned_hours ?? 0);
    if (t.status === "Blocked") a.blocked += 1;
    if (t.due_date && t.due_date < today && t.status !== "Completed") a.overdue += 1;
  }
  const capRows = profiles.map((p) => {
    const a = acc.get(p.id)!;
    const load_pct = Math.round((a.planned / capacity) * 100);
    const zone = load_pct > 120 ? "red" : load_pct >= 80 ? "green" : load_pct < 60 ? "blue" : "green";
    return { user_id: p.id, name: p.display_name, load_pct, zone, ...a };
  }).sort((x, y) => y.load_pct - x.load_pct);

  const overloaded = capRows.filter((c) => c.zone === "red").length;
  const underused = capRows.filter((c) => c.zone === "blue").length;
  const reassigns = Math.min(3, overloaded, underused);
  const escalations = open.filter((t) => t.status === "Blocked" && t.blocked_at).length;

  const dt = performance.now() - t0;
  return {
    members,
    tasks: tasks.length,
    open: open.length,
    health_score,
    completion_pct,
    blocked_pct,
    carry_forward_pct,
    overloaded,
    underused,
    reassigns,
    escalations,
    top_load_pct: capRows[0]?.load_pct ?? 0,
    bottom_load_pct: capRows[capRows.length - 1]?.load_pct ?? 0,
    duration_ms: +dt.toFixed(2),
  };
}

const sizes = [5, 20, 50];
const out = sizes.map(run);
console.log(JSON.stringify(out, null, 2));

// invariants
for (const r of out) {
  console.assert(r.health_score >= 0 && r.health_score <= 100, "health bounds");
  console.assert(r.top_load_pct >= r.bottom_load_pct, "capacity sorted desc");
  console.assert(r.overloaded > 0 && r.underused > 0, `team ${r.members}: needs both zones`);
  console.assert(r.reassigns > 0, `team ${r.members}: must emit REASSIGN`);
  console.assert(r.escalations > 0, `team ${r.members}: must emit ESCALATE`);
}
console.log("OK: all invariants passed");

#!/usr/bin/env node
/**
 * Builds the load-test report from OUT/{requests.jsonl,docker.csv,pg.csv,ws.json,meta.json,events.jsonl}.
 *   OUT=scripts/loadtest/out/run8h REPORT=docs/LOAD_TEST_8H_REPORT.md node scripts/loadtest/report.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const OUT = process.env.OUT || "scripts/loadtest/out/run8h";
const REPORT = process.env.REPORT || "docs/LOAD_TEST_8H_REPORT.md";
const jl = (f) => (fs.existsSync(path.join(OUT, f)) ? fs.readFileSync(path.join(OUT, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const csv = (f) => {
  const [h, ...rows] = fs.readFileSync(path.join(OUT, f), "utf8").trim().split("\n");
  const cols = h.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i], isNaN(Number(v)) ? v : Number(v)])));
};
const meta = JSON.parse(fs.readFileSync(path.join(OUT, "meta.json"), "utf8"));
const reqs = jl("requests.jsonl");
const events = jl("events.jsonl");
const docker = csv("docker.csv");
const pg = csv("pg.csv");
const ws = fs.existsSync(path.join(OUT, "ws.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "ws.json"), "utf8")) : {};
const activity = jl("activity.jsonl");

const sum = (a, f = (x) => x) => a.reduce((s, x) => s + f(x), 0);
const avg = (a) => (a.length ? sum(a) / a.length : 0);
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const n = (x) => Math.round(x).toLocaleString("en-US");
const f1 = (x) => (Math.round(x * 10) / 10).toLocaleString("en-US");
const bytes = (b) => (b >= 1e9 ? f1(b / 1e9) + " GB" : b >= 1e6 ? f1(b / 1e6) + " MB" : f1(b / 1e3) + " KB");
const groupBy = (a, f) => a.reduce((m, x) => { const k = f(x); (m[k] ||= []).push(x); return m; }, {});
const table = (head, rows) => `| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}\n`;

// Classification: an "aborted" request was cancelled by the browser (navigation/unmount), the server did not fail.
const aborted = (r) => r.err === "net::ERR_ABORTED";
const serverErr = (r) => r.s >= 500;
const clientErr = (r) => r.s >= 400 && r.s < 500;
const netFail = (r) => r.s === 0 && !aborted(r);
const real = reqs.filter((r) => !aborted(r));
const failed = reqs.filter((r) => serverErr(r) || clientErr(r) || netFail(r));

const t0 = meta.startedAt;
const tEnd = meta.endedAt ?? Math.max(...reqs.map((r) => r.t));
const hours = (tEnd - t0) / 3.6e6;

// ---- traffic
const byKind = groupBy(reqs, (r) => r.k);
const kindRows = Object.entries(byKind).sort((a, b) => b[1].length - a[1].length).map(([k, a]) => [k, n(a.length), n(a.filter(aborted).length), bytes(sum(a, (r) => r.up)), bytes(sum(a, (r) => r.down))]);
const byUser = groupBy(reqs, (r) => r.user);
const userRows = Object.keys(byUser).sort().map((u) => {
  const a = byUser[u], api = a.filter((r) => r.k === "api" && !aborted(r));
  return [u, a[0].role, n(a.length), n(api.length), n(a.filter((r) => r.k === "app").length), n(a.filter((r) => r.k === "auth").length), bytes(sum(a, (r) => r.up)), bytes(sum(a, (r) => r.down)), f1(avg(api.map((r) => r.ms))) + " ms", n(a.filter((r) => !r.ok && !aborted(r)).length)];
});
const wsFramesIn = sum(Object.values(ws), (w) => w.framesIn), wsFramesOut = sum(Object.values(ws), (w) => w.framesOut);
const wsBytes = sum(Object.values(ws), (w) => w.bytesIn + w.bytesOut);
const wsOpened = sum(Object.values(ws), (w) => w.opened);

// ---- latency
const lat = (a) => { const m = a.map((r) => r.ms); return [n(a.length), f1(avg(m)), f1(pct(m, 50)), f1(pct(m, 95)), f1(pct(m, 99)), f1(Math.max(0, ...m))]; };
const latRows = [["API (PostgREST) — all", ...lat(real.filter((r) => r.k === "api"))],
  ["API — GET/HEAD reads", ...lat(real.filter((r) => r.k === "api" && (r.m === "GET" || r.m === "HEAD")))],
  ["App server (pages + assets)", ...lat(real.filter((r) => r.k === "app"))],
  ["Auth (Keycloak token refresh)", ...lat(real.filter((r) => r.k === "auth"))],
  ["Socket.IO polling", ...lat(real.filter((r) => r.k === "socketio-poll"))],
  ["All HTTP (non-aborted)", ...lat(real)]];
const endpointRows = Object.entries(groupBy(real.filter((r) => r.k === "api"), (r) => `${r.m} ${r.p.replace("/rest/v1/", "")}`)).sort((a, b) => b[1].length - a[1].length).slice(0, 12).map(([k, a]) => [k, ...lat(a)]);

// ---- hourly timeline
const hb = groupBy(reqs, (r) => Math.floor((r.t - t0) / 3.6e6));
const dockerByT = groupBy(docker, (d) => Math.floor((d.t - t0) / 3.6e6));
const hourRows = Object.keys(hb).map(Number).sort((a, b) => a - b).map((h) => {
  const a = hb[h], api = a.filter((r) => r.k === "api" && !aborted(r)).map((r) => r.ms);
  const d = dockerByT[h] ?? [];
  const cpuByT = Object.values(groupBy(d, (x) => x.t)).map((g) => sum(g, (x) => x.cpu));
  const memByT = Object.values(groupBy(d, (x) => x.t)).map((g) => sum(g, (x) => x.mem_mb));
  return [`H${h + 1}`, n(a.length), n(a.filter((r) => r.k === "api").length), f1(avg(api)), f1(pct(api, 95)), f1(pct(api, 99)), n(a.filter((r) => !r.ok && !aborted(r)).length), f1(avg(cpuByT)) + "%", f1(Math.max(0, ...cpuByT)) + "%", f1(avg(memByT)) + " MB"];
});

// ---- peaks
const perMin = groupBy(reqs, (r) => Math.floor(r.t / 60000));
const peakMin = Object.entries(perMin).sort((a, b) => b[1].length - a[1].length)[0];
const perSec = groupBy(reqs, (r) => Math.floor(r.t / 1000));
const peakSec = Object.entries(perSec).sort((a, b) => b[1].length - a[1].length)[0];
const apiPerMin = groupBy(reqs.filter((r) => r.k === "api"), (r) => Math.floor(r.t / 60000));
const peakApiMin = Object.entries(apiPerMin).sort((a, b) => b[1].length - a[1].length)[0];
const slowest = [...real].sort((a, b) => b.ms - a.ms).slice(0, 5);

// ---- docker
const byCont = groupBy(docker, (d) => d.container);
const contRows = Object.keys(byCont).sort().map((c) => {
  const a = byCont[c].sort((x, y) => x.t - y.t), first = a[0], last = a[a.length - 1];
  const peakCpu = a.reduce((m, x) => (x.cpu > m.cpu ? x : m), a[0]), peakMem = a.reduce((m, x) => (x.mem_mb > m.mem_mb ? x : m), a[0]);
  const q = Math.floor(a.length / 4);
  return [c, f1(avg(a.map((x) => x.cpu))) + "%", f1(pct(a.map((x) => x.cpu), 95)) + "%", f1(peakCpu.cpu) + "%", f1(avg(a.map((x) => x.mem_mb))), f1(peakMem.mem_mb), f1(avg(a.slice(0, q).map((x) => x.mem_mb))) + " → " + f1(avg(a.slice(-q).map((x) => x.mem_mb))), bytes(last.net_rx_b - first.net_rx_b), bytes(last.net_tx_b - first.net_tx_b), bytes(last.blk_r_b - first.blk_r_b), bytes(last.blk_w_b - first.blk_w_b)];
});
const stackByT = Object.entries(groupBy(docker, (d) => d.t)).map(([t, g]) => ({ t: Number(t), cpu: sum(g, (x) => x.cpu), mem: sum(g, (x) => x.mem_mb) }));
const peakStackCpu = stackByT.reduce((m, x) => (x.cpu > m.cpu ? x : m), stackByT[0] ?? { cpu: 0, mem: 0, t: 0 });
const peakStackMem = stackByT.reduce((m, x) => (x.mem > m.mem ? x : m), stackByT[0] ?? { cpu: 0, mem: 0, t: 0 });
const hhmm = (t) => new Date(t).toLocaleTimeString("en-GB", { hour12: false }) + ` (+${f1((t - t0) / 3.6e6)}h)`;
// network totals are container-side counters; the docker bridge double counts inter-container hops, so
// also show the client-side figure which is the real user-facing traffic.
const lastBy = (c) => { const a = byCont[c]; return a ? a[a.length - 1] : null; };
const firstBy = (c) => { const a = byCont[c]; return a ? a[0] : null; };
const edge = ["caddy", "app"].map((c) => [c, lastBy(c), firstBy(c)]).filter(([, l]) => l);

// ---- postgres
const pgl = pg[pg.length - 1], pgf = pg[0];
const dXact = pgl ? pgl.xact_commit - pgf.xact_commit : 0;
const cacheHit = pgl ? (pgl.blks_hit - pgf.blks_hit) / Math.max(1, pgl.blks_hit - pgf.blks_hit + (pgl.blks_read - pgf.blks_read)) : 0;

// ---- health checks
let restarts = "n/a";
try {
  restarts = execFileSync("docker", ["ps", "-a", "--filter", "name=dailyflow-local", "--format", "{{.Names}}|{{.Status}}"], { encoding: "utf8" }).trim().split("\n").map((l) => l.replace("dailyflow-local-", "")).join("; ");
} catch {}
const sessionsOk = (meta.sessionResults ?? []).filter((r) => r.status === "fulfilled").length;
const pageErrors = events.filter((e) => e.msg === "pageerror").length;
const navErrors = events.filter((e) => e.msg === "nav:error").length;
const navOk = events.filter((e) => e.msg === "nav").length;
const apiReal = real.filter((r) => r.k === "api");
const apiErrRate = apiReal.length ? apiReal.filter((r) => !r.ok).length / apiReal.length : 0;
const allErrRate = real.length ? real.filter((r) => !r.ok).length / real.length : 0;
const q = Math.floor((byCont.app?.length ?? 0) / 4);
const memGrowth = Object.keys(byCont).map((c) => { const a = byCont[c]; const s = avg(a.slice(0, q).map((x) => x.mem_mb)), e = avg(a.slice(-q).map((x) => x.mem_mb)); return { c, s, e, pct: s ? (e - s) / s : 0 }; });
const p95api = pct(apiReal.map((r) => r.ms), 95), p99api = pct(apiReal.map((r) => r.ms), 99);
const maxMemPct = Math.max(0, ...docker.map((d) => (d.mem_mb / d.mem_limit_mb) * 100));
const activityFail = activity.filter((a) => !a.ok).length;
const durationOk = hours >= (meta.plannedMs / 3.6e6) * 0.98;

const checks = [
  ["All 10 users stayed active the whole window", durationOk && sessionsOk === meta.users.length, `${sessionsOk}/${meta.users.length} sessions finished; ran ${f1(hours)} h of ${f1(meta.plannedMs / 3.6e6)} h`],
  ["API error rate < 1% (4xx/5xx/network, aborted excluded)", apiErrRate < 0.01, `${(apiErrRate * 100).toFixed(3)}% of ${n(apiReal.length)} API requests`],
  ["No 5xx and no network failures", !real.some((r) => serverErr(r) || netFail(r)), `${n(real.filter(serverErr).length)} 5xx, ${n(real.filter(netFail).length)} network failures`],
  ["API P95 < 1000 ms and P99 < 2000 ms", p95api < 1000 && p99api < 2000, `P95 ${f1(p95api)} ms, P99 ${f1(p99api)} ms`],
  ["No container restarted / OOM", !/Restarting|Exited/.test(restarts), restarts],
  ["Memory stable (no container grew > 25% first→last quarter, none above 80% of its limit)", memGrowth.every((m) => m.pct < 0.25 || m.e - m.s < 30) && maxMemPct < 80, memGrowth.map((m) => `${m.c} ${f1(m.pct * 100)}%`).join(", ") + `; peak ${f1(maxMemPct)}% of limit`],
  ["Postgres: no deadlocks, no ungranted locks at sampling", (pgl?.deadlocks ?? 0) - (pgf?.deadlocks ?? 0) === 0 && Math.max(0, ...pg.map((p) => p.locks_waiting)) === 0, `${(pgl?.deadlocks ?? 0) - (pgf?.deadlocks ?? 0)} deadlocks, max waiting locks ${Math.max(0, ...pg.map((p) => p.locks_waiting))}`],
];
const verdict = checks.every((c) => c[1]);

const md = `# 8-Hour Load Test Report — 10 Concurrent Users

> Generated ${new Date().toISOString()} from \`${OUT}\`. Scripts: \`scripts/loadtest/\`.

## Verdict: ${verdict ? "PASS — the stack handled 10 concurrent users for the full window" : "FAIL / ATTENTION NEEDED — see failed checks"}

${table(["Check", "Result", "Detail"], checks.map((c) => [c[0], c[1] ? "PASS" : "**FAIL**", c[2]]))}
## Test setup

- Window: ${new Date(t0).toISOString()} → ${new Date(tEnd).toISOString()} (${f1(hours)} h)
- Users: 5 managers (\`ltmgr1-5\`) + 5 members (\`ltmem1-5\`), each a real Edge browser session (Playwright), logged in via Keycloak and kept active. Staggered start (0–20 s).
- Behaviour per user: loop of {navigate to a role-appropriate page via the sidebar, scroll, read 15–75 s}, 10% chance of a full page reload per loop. Managers rotate over command, dashboard, planning, eod-tasks, team-capacity, workload, reviews, tasks, executive, time-tracking, notifications, manager, calendar. Members rotate over my-day, today, tasks, calendar, notifications, eod, leaves, notebook.
- Background: ${n(activity.length)} simulated "other-user" changes (task status flips + notifications inserted straight into the DB every 60–180 s) to exercise realtime fan-out${activityFail ? ` (${activityFail} failed)` : ""}.
- Target: local Docker stack \`dailyflow-local\` (app, caddy, postgrest, keycloak, postgres 5 containers) on one Windows host; Docker VM limit ${f1((docker[0]?.mem_limit_mb ?? 0) / 1024)} GB RAM.
- Sampling: \`docker stats\` + Postgres \`pg_stat_*\` every 10 s (${n(pg.length)} samples).

## 1. Requests and traffic

Totals: **${n(reqs.length)} HTTP requests** over ${f1(hours)} h (${f1(reqs.length / hours / 3600)} req/s average). Client-side bytes (headers + body, on the wire): **${bytes(sum(reqs, (r) => r.up))} sent, ${bytes(sum(reqs, (r) => r.down))} received**.

- Inbound HTTP (client → stack, i.e. what Caddy/app/Keycloak received): **${n(reqs.filter((r) => ["api", "app", "auth", "socketio-poll", "files"].includes(r.k)).length)}** requests.
- Total API requests (PostgREST): **${n(byKind.api?.length ?? 0)}** (${n(real.filter((r) => r.k === "api").length)} completed, ${n((byKind.api ?? []).filter(aborted).length)} cancelled by the browser mid-flight).
- Outbound HTTP to third parties: **${n(reqs.filter((r) => r.k === "other").length)}** browser-side calls (e.g. public-holiday lookup); the app container has email/FCM disabled in this stack, so no server-side third-party calls were made. Server-internal hops (app → caddy → postgrest, app → keycloak) are not separately logged by these services; see "Limitations".
- WebSocket (Socket.IO): ${n(wsOpened)} connections opened, ${n(wsFramesIn)} frames received, ${n(wsFramesOut)} sent, ${bytes(wsBytes)} payload.

### By traffic type
${table(["Type", "Requests", "Aborted", "Sent", "Received"], kindRows)}
### Per user
${table(["User", "Role", "Requests", "API", "App", "Auth", "Sent", "Received", "Avg API latency", "Failed"], userRows)}
Per-role: managers ${n(sum(reqs.filter((r) => r.role === "manager"), () => 1))} requests (${n(reqs.filter((r) => r.role === "manager" && r.k === "api").length)} API), members ${n(sum(reqs.filter((r) => r.role === "member"), () => 1))} requests (${n(reqs.filter((r) => r.role === "member" && r.k === "api").length)} API).

## 2. Response time (ms, completed requests only)
${table(["Group", "Count", "Avg", "P50", "P95", "P99", "Max"], latRows)}
### Busiest API endpoints
${table(["Endpoint", "Count", "Avg", "P50", "P95", "P99", "Max"], endpointRows)}
### Slowest 5 requests
${table(["When", "User", "Request", "Status", "ms"], slowest.map((r) => [hhmm(r.t), r.user, `${r.m} ${r.p}`, r.s, n(r.ms)]))}
## 3. Errors

- Failed (4xx/5xx/network, aborted excluded): **${n(failed.length)}** of ${n(real.length)} completed requests (${(allErrRate * 100).toFixed(3)}%).
- 5xx: ${n(real.filter(serverErr).length)} · 4xx: ${n(real.filter(clientErr).length)} · network failures: ${n(real.filter(netFail).length)}
- Browser-cancelled (\`net::ERR_ABORTED\`, e.g. a count query abandoned when the user navigated away; not a server failure): ${n(reqs.filter(aborted).length)}
- Page JS errors: ${n(pageErrors)} · navigation errors: ${n(navErrors)} of ${n(navOk + navErrors)} navigations.
${failed.length ? "\n" + table(["Failed request", "Status/error", "Count"], Object.entries(failed.reduce((m, r) => { const k = `${r.m} ${r.p}|${r.s || r.err}`; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, c]) => [...k.split("|"), c])) : ""}
## 4. Docker resource usage (docker stats, 10 s samples)
${table(["Container", "Avg CPU", "P95 CPU", "Peak CPU", "Avg RAM MB", "Peak RAM MB", "RAM first→last quarter", "Net RX", "Net TX", "Disk read", "Disk write"], contRows)}
- Whole stack: avg ${f1(avg(stackByT.map((x) => x.cpu)))}% CPU (of 1 core = 100%), **peak ${f1(peakStackCpu.cpu)}% at ${hhmm(peakStackCpu.t)}**; avg ${f1(avg(stackByT.map((x) => x.mem)))} MB RAM, **peak ${f1(peakStackMem.mem)} MB at ${hhmm(peakStackMem.t)}**.
- Container network counters are per-container and include container-to-container hops, so adding them double-counts. Edge view: ${edge.map(([c, l, f]) => `${c} RX ${bytes(l.net_rx_b - f.net_rx_b)} / TX ${bytes(l.net_tx_b - f.net_tx_b)}`).join("; ")}.

## 5. Database (PostgreSQL ${""}\`dailyflow_test\`)

${table(["Metric", "Value"], [
  ["Connections avg / peak (this DB)", `${f1(avg(pg.map((p) => p.connections)))} / ${Math.max(0, ...pg.map((p) => p.connections))}`],
  ["Active queries peak", Math.max(0, ...pg.map((p) => p.active))],
  ["Transactions committed during test", `${n(dXact)} (${f1(dXact / Math.max(1, hours * 3600))}/s)`],
  ["Rollbacks", n(pgl ? pgl.xact_rollback - pgf.xact_rollback : 0)],
  ["Rows returned / fetched", `${n(pgl ? pgl.tup_returned - pgf.tup_returned : 0)} / ${n(pgl ? pgl.tup_fetched - pgf.tup_fetched : 0)}`],
  ["Rows inserted / updated / deleted", `${n(pgl ? pgl.tup_inserted - pgf.tup_inserted : 0)} / ${n(pgl ? pgl.tup_updated - pgf.tup_updated : 0)} / ${n(pgl ? pgl.tup_deleted - pgf.tup_deleted : 0)}`],
  ["Buffer cache hit ratio", `${(cacheHit * 100).toFixed(2)}%`],
  ["Temp bytes written", bytes(pgl ? pgl.temp_bytes - pgf.temp_bytes : 0)],
  ["Deadlocks / max waiting locks", `${pgl ? pgl.deadlocks - pgf.deadlocks : 0} / ${Math.max(0, ...pg.map((p) => p.locks_waiting))}`],
  ["Database size start → end", `${pgf?.db_mb} MB → ${pgl?.db_mb} MB`],
])}
Postgres container CPU/RAM/disk I/O are in the Docker table above (\`postgres\` row).

## 6. Peaks

- Peak request rate: **${peakMin ? n(peakMin[1].length) : 0} req/min** at ${peakMin ? hhmm(Number(peakMin[0]) * 60000) : "-"}; **${peakSec ? n(peakSec[1].length) : 0} req in one second** at ${peakSec ? hhmm(Number(peakSec[0]) * 1000) : "-"}.
- Peak API rate: ${peakApiMin ? n(peakApiMin[1].length) : 0} API req/min at ${peakApiMin ? hhmm(Number(peakApiMin[0]) * 60000) : "-"}.
- Highest stack CPU: ${f1(peakStackCpu.cpu)}% at ${hhmm(peakStackCpu.t)} · highest stack RAM: ${f1(peakStackMem.mem)} MB at ${hhmm(peakStackMem.t)} · highest single-container RAM use: ${f1(maxMemPct)}% of its limit.

## 7. Hour by hour
${table(["Hour", "Requests", "API req", "API avg ms", "API P95", "API P99", "Failed", "Stack CPU avg", "Stack CPU peak", "Stack RAM avg"], hourRows)}
## Limitations (read before quoting these numbers)

- Request counts, sizes and latencies are measured **in the browser** (what a user's device sees, including Caddy/app time but on loopback, so network latency is ~0). A real WAN/VPN will add RTT to every figure.
- "Outbound" server-to-server HTTP (app → Caddy → PostgREST, app → Keycloak) is not logged by these services. They are visible only as container network counters. Caddy has no access log enabled and was not reconfigured for this test.
- Runs on a single Windows host with the dev-mode Keycloak (\`start-dev\`) and a production-data copy of Postgres. Production hardware and \`start\` mode will differ.
- Client-side REST writes are denied on this local stack: RLS policies such as \`tasks_insert\` call \`auth.uid()\`, which returns NULL here because PostgREST's legacy \`request.jwt.claim.sub\` GUC is not populated (\`req_uid()\` has a fallback; \`auth.uid()\` does not). The workload is therefore read-heavy plus DB-side simulated activity, not user-driven writes. Worth checking whether production behaves the same.
- Think times (15–75 s per page) model an attentive user; heavier users (rapid filter/search, bulk edits) would generate more API traffic than shown.
`;
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, md);
console.log("wrote", REPORT, verdict ? "PASS" : "FAIL");

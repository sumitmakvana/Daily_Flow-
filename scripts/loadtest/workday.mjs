#!/usr/bin/env node
/**
 * One simulated working day for one manager (ltmgr1) and one member (ltmem1) against the LOCAL stack.
 * Fixed timeline, no randomness, so two builds can be compared on identical activity.
 *
 *   set -a; . scripts/loadtest/.env.loadtest; set +a
 *   MSYS_NO_PATHCONV=1 OUT=scripts/loadtest/out/wd_x node scripts/loadtest/workday.mjs
 *
 * TIME_SCALE (<1 = faster, e.g. 0.2 for a smoke run) compresses the 15-minute timeline.
 * Writes OUT/requests.jsonl (every request incl. HEAD, with the step it belongs to), OUT/steps.jsonl
 * (each step: ok/fail, page load ms), OUT/ws.json (WebSocket frames/bytes per user) and OUT/meta.json.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const APP = process.env.APP_URL || "http://localhost:7050";
const KC = "http://localhost:7052/realms/lovable/protocol/openid-connect/token";
const OUT = process.env.OUT || "scripts/loadtest/out/wd";
const SCALE = Number(process.env.TIME_SCALE || 1);
const users = JSON.parse(fs.readFileSync("scripts/loadtest/users.local.json", "utf8"));
const MANAGER = users.find((u) => u.n === "ltmgr1");
const MEMBER = users.find((u) => u.n === "ltmem1");
const TASKS = ["WD Task 1", "WD Task 2", "WD Task 3", "WD Task 4"];
fs.mkdirSync(OUT, { recursive: true });

const reqs = fs.createWriteStream(path.join(OUT, "requests.jsonl"), { flags: "a" });
const stepsLog = fs.createWriteStream(path.join(OUT, "steps.jsonl"), { flags: "a" });
const ws = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let T0 = 0;
const at = async (sec) => { const due = T0 + sec * 1000 * SCALE; if (due > Date.now()) await sleep(due - Date.now()); };

const kind = (url) => {
  const x = new URL(url);
  if (x.port === "7051") return "api";
  if (x.port === "7052") return "auth";
  if (x.pathname.startsWith("/socket.io")) return "socketio-poll";
  if (x.pathname.startsWith("/_serverFn")) return "serverfn";
  return x.port === "7050" ? "app" : "other";
};

async function login(u) {
  const r = await fetch(KC, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", client_id: "execution-os", username: u.email, password: process.env.LT_PASSWORD }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login failed for ${u.n}: ${j.error_description}`);
  return j;
}

async function open(browser, u) {
  const tok = await login(u);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(({ a, r }) => { try { if (!localStorage.getItem("kc_token")) { localStorage.setItem("kc_token", a); localStorage.setItem("kc_refresh_token", r); } } catch {} }, { a: tok.access_token, r: tok.refresh_token });
  const page = await ctx.newPage();
  const s = { u, page, ctx, step: "login" };
  ws[u.n] = { opened: 0, framesIn: 0, framesOut: 0, bytesIn: 0, bytesOut: 0 };
  const start = new Map();
  const write = (rq, rs, sizes, err) => {
    const x = new URL(rq.url());
    reqs.write(JSON.stringify({ t: start.get(rq) ?? Date.now(), ms: Date.now() - (start.get(rq) ?? Date.now()), user: u.n, step: s.step, k: kind(rq.url()), m: rq.method(), p: x.pathname, q: x.search.slice(0, 200), s: rs?.status() ?? 0, up: (sizes?.requestHeadersSize ?? 0) + (sizes?.requestBodySize ?? 0), down: (sizes?.responseHeadersSize ?? 0) + (sizes?.responseBodySize ?? 0), ok: !err && (rs?.status() ?? 0) < 400, err }) + "\n");
    start.delete(rq);
  };
  page.on("request", (rq) => start.set(rq, Date.now()));
  page.on("requestfinished", async (rq) => { let z = null; try { z = await rq.sizes(); } catch {} write(rq, await rq.response().catch(() => null), z); });
  // HEAD count requests are reported as "failed" (no body) by the browser; keep them, with what we know.
  page.on("requestfailed", (rq) => write(rq, null, null, rq.failure()?.errorText));
  page.on("websocket", (w) => {
    const c = ws[u.n]; c.opened++;
    w.on("framereceived", (f) => { c.framesIn++; c.bytesIn += f.payload?.length ?? 0; });
    w.on("framesent", (f) => { c.framesOut++; c.bytesOut += f.payload?.length ?? 0; });
  });
  return s;
}

/** Runs one named step; a failure is logged and the day continues (both builds then did the same steps). */
async function step(s, name, fn) {
  s.step = name;
  const t = Date.now();
  try {
    const extra = (await fn()) || {};
    stepsLog.write(JSON.stringify({ t, user: s.u.n, step: name, ok: true, ms: Date.now() - t, ...extra }) + "\n");
  } catch (e) {
    await s.page.screenshot({ path: path.join(OUT, `fail-${s.u.n}-${name.replace(/[^a-z0-9]+/gi, "_")}.png`) }).catch(() => {});
    stepsLog.write(JSON.stringify({ t, user: s.u.n, step: name, ok: false, ms: Date.now() - t, err: String(e).split("\n")[0].slice(0, 200) }) + "\n");
  }
}

const quiet = (p) => p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
/** Closes what a user would close before moving on: modals (Escape, else their ✕) and the satisfaction survey card. */
async function closeOverlays(p) {
  const survey = p.getByText("How satisfied are you with Operon overall?");
  if (await survey.isVisible().catch(() => false)) await survey.locator("xpath=..").getByRole("button").first().click({ timeout: 2000 }).catch(() => {});
  for (let i = 0; i < 2; i++) {
    if (!(await p.getByRole("dialog").count())) return;
    await p.keyboard.press("Escape");
    await sleep(400);
  }
  const d = p.getByRole("dialog").last();
  if (await d.count()) await d.locator("button:has(svg.lucide-x), button[aria-label='Close']").first().click({ timeout: 2000 }).catch(() => {});
  await sleep(400);
}
const read = async (p) => { for (let i = 0; i < 2; i++) { await p.mouse.wheel(0, 400).catch(() => {}); await sleep(1500 * SCALE); } };

/** Navigate like a user (sidebar link), measure until the network is quiet. */
async function visit(s, route) {
  await step(s, `visit ${route}`, async () => {
    const p = s.page;
    await closeOverlays(p);
    const t = Date.now();
    const link = p.locator(`a[href="${route}"]`).first();
    if (await link.isVisible({ timeout: 1000 }).catch(() => false)) await link.click({ timeout: 5000 });
    else await p.goto(APP + route, { waitUntil: "load", timeout: 30_000 });
    await quiet(p);
    const loadMs = Date.now() - t;
    await read(p);
    return { route, loadMs, landed: new URL(p.url()).pathname };
  });
}

async function fullLoad(s, route, label = `load ${route}`) {
  await step(s, label, async () => {
    const t = Date.now();
    if (route) await s.page.goto(APP + route, { waitUntil: "load", timeout: 30_000 });
    else await s.page.reload({ waitUntil: "load", timeout: 30_000 });
    await quiet(s.page);
    return { route: route || new URL(s.page.url()).pathname, loadMs: Date.now() - t, full: true };
  });
  await closeOverlays(s.page);
}

async function openTask(p, name) {
  await closeOverlays(p);
  await p.getByText(name, { exact: true }).first().click({ timeout: 10_000 });
  await p.getByRole("dialog").first().waitFor({ timeout: 10_000 });
  return p.getByRole("dialog").first();
}
const closeTask = async (p) => { await p.keyboard.press("Escape"); await sleep(600); };

async function createTask(s, name) {
  await step(s, `create ${name}`, async () => {
    const p = s.page;
    await closeOverlays(p);
    await p.getByRole("button", { name: "New task" }).first().click({ timeout: 10_000 });
    const d = p.getByRole("dialog");
    await d.getByPlaceholder("Task title (e.g. Filllo Web Design)...").fill(name);
    await d.getByRole("combobox").first().click();
    await p.getByRole("option", { name: MEMBER.n, exact: true }).click({ timeout: 5000 });
    await d.getByRole("button", { name: "Create Task" }).click();
    await p.getByRole("dialog").waitFor({ state: "detached", timeout: 15_000 });
    await quiet(p);
  });
}

async function startTask(s, name) {
  await step(s, `start ${name}`, async () => {
    const d = await openTask(s.page, name);
    await d.getByRole("button", { name: "Start Timer" }).click({ timeout: 5000 });
    // Only one task may run: the app asks to stop the current one first.
    const sw = s.page.getByRole("button", { name: "Stop & Start New Task" });
    if (await sw.isVisible({ timeout: 2000 }).catch(() => false)) await sw.click();
    await d.getByRole("button", { name: "Pause Timer" }).waitFor({ timeout: 10_000 });
    await closeTask(s.page);
  });
}

async function comment(s, name, text) {
  await step(s, `progress ${name}`, async () => {
    const d = await openTask(s.page, name);
    await d.getByPlaceholder(/Add a comment/).fill(text);
    await d.getByRole("button", { name: "Post Comment" }).click({ timeout: 5000 });
    await d.getByText(text).first().waitFor({ timeout: 10_000 });
    await closeTask(s.page);
  });
}

async function complete(s, name) {
  await step(s, `complete ${name}`, async () => {
    const p = s.page;
    const d = await openTask(p, name);
    await d.getByRole("button", { name: /^(In Progress|To Do)$/ }).first().click({ timeout: 5000 });
    await p.getByRole("menuitem", { name: "Completed" }).or(p.getByRole("option", { name: "Completed" })).first().click({ timeout: 5000 });
    await d.getByRole("button", { name: "Reopen Task" }).waitFor({ timeout: 10_000 });
    await closeTask(p);
    await closeOverlays(p); // completion may open the EOD hours dialog: leave it (EOD is submitted later)
  });
}

async function submitEod(s, name, hoursButton) {
  await step(s, `eod ${name}`, async () => {
    const card = s.page.locator("div").filter({ has: s.page.getByText(name, { exact: true }) }).filter({ has: s.page.getByRole("button", { name: "Submit EOD" }) }).last();
    await card.getByRole("button", { name: "In progress" }).click({ timeout: 5000 });
    await card.getByRole("button", { name: hoursButton }).click({ timeout: 5000 });
    await card.getByPlaceholder("Note for your manager (optional)…").fill(`EOD note for ${name}`);
    await card.getByRole("button", { name: "Submit EOD" }).click({ timeout: 5000 });
    await quiet(s.page);
  });
}

// ---- the day (seconds from start, before TIME_SCALE) --------------------------------------------------------

async function managerDay(m) {
  await fullLoad(m, "/my-day", "login + load /my-day");
  await at(30); await visit(m, "/notifications");
  await at(60); await visit(m, "/team-capacity");
  await at(90); await visit(m, "/tasks");
  for (const t of TASKS) await createTask(m, t);
  await at(180); await visit(m, "/executive");
  await at(220); await visit(m, "/calendar");
  await at(260); await visit(m, "/team-capacity");
  await at(360); await visit(m, "/tasks");
  await step(m, "check progress (Team Tasks tab)", () => m.page.getByText(/^Team Tasks \(/).first().click({ timeout: 5000 }).then(() => quiet(m.page)));
  await at(400); await visit(m, "/notebook");
  await at(480); await visit(m, "/eod");
  await at(600); await visit(m, "/team-capacity");
  await at(650); await visit(m, "/executive");
  await at(720); await visit(m, "/tasks");
  await at(760); await visit(m, "/notifications");
  await at(810); await visit(m, "/eod");
  await step(m, "review member EOD (Inspect ltmem1)", async () => {
    const row = m.page.locator("tr, [role=row], div").filter({ hasText: MEMBER.n }).filter({ has: m.page.getByRole("button", { name: "Inspect" }) }).last();
    await row.getByRole("button", { name: "Inspect" }).first().click({ timeout: 5000 });
    await quiet(m.page);
    await sleep(3000 * SCALE);
    await closeOverlays(m.page);
  });
  await at(850); await visit(m, "/team-capacity");
  await at(870); await fullLoad(m, null, "reload");
  await at(900);
}

async function memberDay(e) {
  await fullLoad(e, "/my-day", "login + load /my-day");
  await at(30); await visit(e, "/notifications");
  await at(90); await visit(e, "/my-day");
  await at(180); await visit(e, "/notifications");
  await at(210); await visit(e, "/tasks");
  await at(240); await startTask(e, TASKS[0]);
  await at(330); await visit(e, "/calendar");
  await at(360); await visit(e, "/tasks");
  await comment(e, TASKS[0], "Progress: 50% done");
  await startTask(e, TASKS[1]);
  await at(480); await complete(e, TASKS[0]);
  await at(510); await visit(e, "/calendar");
  await at(540); await visit(e, "/notebook");
  await at(600); await visit(e, "/tasks");
  await complete(e, TASKS[1]);
  await comment(e, TASKS[2], "Progress: analysis started");
  await at(660); await visit(e, "/notifications");
  await at(720); await visit(e, "/eod-tasks");
  await submitEod(e, TASKS[2], "+1h");
  await submitEod(e, TASKS[3], "+0.5h");
  await at(810); await visit(e, "/my-day");
  await at(840); await visit(e, "/tasks");
  await at(870); await fullLoad(e, null, "reload");
  await at(900);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const [m, e] = await Promise.all([open(browser, MANAGER), open(browser, MEMBER)]);
T0 = Date.now();
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ startedAt: T0, scale: SCALE, users: [MANAGER.n, MEMBER.n] }));
const wsTimer = setInterval(() => fs.writeFileSync(path.join(OUT, "ws.json"), JSON.stringify(ws)), 30_000);
const results = await Promise.allSettled([managerDay(m), memberDay(e)]);
clearInterval(wsTimer);
fs.writeFileSync(path.join(OUT, "ws.json"), JSON.stringify(ws));
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ startedAt: T0, endedAt: Date.now(), scale: SCALE, users: [MANAGER.n, MEMBER.n], results: results.map((r) => r.status + (r.reason ? ": " + String(r.reason).slice(0, 200) : "")) }));
await browser.close();
reqs.end(); stepsLog.end();
console.log("done", results.map((r) => r.status).join(","));

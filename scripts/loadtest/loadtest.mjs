#!/usr/bin/env node
/**
 * Browser-driven load test: one Edge context per user (5 managers + 5 members),
 * all kept active for DURATION_MIN minutes against the LOCAL stack.
 *
 *   set -a; . scripts/loadtest/.env.loadtest; set +a
 *   DURATION_MIN=480 OUT=scripts/loadtest/out/run1 node scripts/loadtest/loadtest.mjs
 *
 * Every request/response made by the page (app, PostgREST, Keycloak) is
 * written to OUT/requests.jsonl with timing + byte sizes; WebSocket frames
 * are counted per user in OUT/ws.json (written periodically).
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const APP = process.env.APP_URL || "http://localhost:7050";
const KC = "http://localhost:7052/realms/lovable/protocol/openid-connect/token";
const DURATION_MS = Number(process.env.DURATION_MIN || 480) * 60_000;
const THINK = Number(process.env.THINK_SCALE || 1); // <1 = faster (smoke runs)
const OUT = process.env.OUT || "scripts/loadtest/out/run";
const PASSWORD = process.env.LT_PASSWORD;
const users = JSON.parse(fs.readFileSync("scripts/loadtest/users.local.json", "utf8"));
fs.mkdirSync(OUT, { recursive: true });

const ROUTES = {
  manager: ["/command", "/dashboard", "/planning", "/eod-tasks", "/team-capacity", "/workload", "/reviews", "/tasks", "/executive", "/time-tracking", "/notifications", "/manager", "/calendar"],
  member: ["/my-day", "/today", "/tasks", "/calendar", "/notifications", "/eod", "/leaves", "/notebook", "/my-day", "/today"],
};
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stream = fs.createWriteStream(path.join(OUT, "requests.jsonl"), { flags: "a" });
const events = fs.createWriteStream(path.join(OUT, "events.jsonl"), { flags: "a" });
const ws = {};
const log = (u, msg, extra = {}) => events.write(JSON.stringify({ t: Date.now(), user: u.n, msg, ...extra }) + "\n");
const endAt = Date.now() + DURATION_MS;

async function login(u) {
  const r = await fetch(KC, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", client_id: "execution-os", username: u.email, password: PASSWORD }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login failed for ${u.n}: ${j.error_description}`);
  return j;
}

const kind = (url) => {
  const x = new URL(url);
  if (x.port === "7051") return "api";
  if (x.port === "7052") return "auth";
  if (x.pathname.startsWith("/socket.io")) return "socketio-poll";
  if (x.pathname.startsWith("/app-storage")) return "files";
  return x.port === "7050" ? "app" : "other";
};

async function session(u, browser) {
  const tok = await login(u);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(({ a, r }) => { try { if (!localStorage.getItem("kc_token")) { localStorage.setItem("kc_token", a); localStorage.setItem("kc_refresh_token", r); } } catch {} }, { a: tok.access_token, r: tok.refresh_token });
  const page = await ctx.newPage();
  ws[u.n] = { opened: 0, framesIn: 0, framesOut: 0, bytesIn: 0, bytesOut: 0, closed: 0 };
  const start = new Map();
  page.on("request", (rq) => start.set(rq, Date.now()));
  page.on("requestfinished", async (rq) => {
    const t0 = start.get(rq) ?? Date.now(); start.delete(rq);
    let sizes = null; try { sizes = await rq.sizes(); } catch {}
    const rs = await rq.response().catch(() => null);
    stream.write(JSON.stringify({ t: t0, ms: Date.now() - t0, user: u.n, role: u.role, k: kind(rq.url()), m: rq.method(), p: new URL(rq.url()).pathname, s: rs?.status() ?? 0, up: (sizes?.requestHeadersSize ?? 0) + (sizes?.requestBodySize ?? 0), down: (sizes?.responseHeadersSize ?? 0) + (sizes?.responseBodySize ?? 0), ok: (rs?.status() ?? 0) < 400 }) + "\n");
  });
  page.on("requestfailed", (rq) => {
    const t0 = start.get(rq) ?? Date.now(); start.delete(rq);
    stream.write(JSON.stringify({ t: t0, ms: Date.now() - t0, user: u.n, role: u.role, k: kind(rq.url()), m: rq.method(), p: new URL(rq.url()).pathname, s: 0, up: 0, down: 0, ok: false, err: rq.failure()?.errorText }) + "\n");
  });
  page.on("websocket", (w) => {
    const c = ws[u.n]; c.opened++;
    w.on("framereceived", (f) => { c.framesIn++; c.bytesIn += (f.payload?.length ?? 0); });
    w.on("framesent", (f) => { c.framesOut++; c.bytesOut += (f.payload?.length ?? 0); });
    w.on("close", () => c.closed++);
  });
  page.on("pageerror", (e) => log(u, "pageerror", { err: String(e).slice(0, 200) }));

  await sleep(rand(0, 20_000) * THINK); // stagger the logins
  await page.goto(APP + ROUTES[u.role][0], { waitUntil: "load" });
  log(u, "session:start");
  while (Date.now() < endAt) {
    const route = pick(ROUTES[u.role]);
    try {
      const link = page.locator(`a[href="${route}"]`).first();
      if (await link.isVisible({ timeout: 1000 }).catch(() => false)) await link.click({ timeout: 5000 });
      else await page.goto(APP + route, { waitUntil: "load", timeout: 30_000 });
      log(u, "nav", { route, url: page.url() });
    } catch (e) { log(u, "nav:error", { route, err: String(e).slice(0, 200) }); }
    // in-page activity: scroll a bit, then idle ("reading")
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, rand(200, 700)).catch(() => {}); await sleep(rand(3, 10) * 1000 * THINK); }
    if (Math.random() < 0.1) { await page.reload({ waitUntil: "load" }).catch(() => {}); log(u, "reload"); }
    await sleep(rand(15, 75) * 1000 * THINK);
  }
  log(u, "session:end");
  await ctx.close();
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const t0 = Date.now();
const meta = { startedAt: t0, plannedMs: DURATION_MS, users: users.map((u) => u.n), think: THINK };
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta));
const wsTimer = setInterval(() => fs.writeFileSync(path.join(OUT, "ws.json"), JSON.stringify(ws)), 30_000);
const results = await Promise.allSettled(users.map((u) => session(u, browser)));
clearInterval(wsTimer);
fs.writeFileSync(path.join(OUT, "ws.json"), JSON.stringify(ws));
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ ...meta, endedAt: Date.now(), sessionResults: results.map((r, i) => ({ u: users[i].n, status: r.status, err: r.reason ? String(r.reason).slice(0, 200) : undefined })) }));
await browser.close();
stream.end(); events.end();
console.log("done", results.map((r) => r.status).join(","));

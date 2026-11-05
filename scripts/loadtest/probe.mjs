#!/usr/bin/env node
/**
 * Deterministic per-route probe: one manager and one member visit every route once
 * (cold page, then idle for IDLE_S) and the bytes/requests per REST resource are recorded
 * with the full query string, so two builds can be compared route by route.
 *   LT_PASSWORD=... OUT=scripts/loadtest/out/probe_x.json node scripts/loadtest/probe.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";

const APP = process.env.APP_URL || "http://localhost:7050";
const KC = "http://localhost:7052/realms/lovable/protocol/openid-connect/token";
const IDLE = Number(process.env.IDLE_S || 8) * 1000;
const OUT = process.env.OUT || "scripts/loadtest/out/probe.json";
const users = JSON.parse(fs.readFileSync("scripts/loadtest/users.local.json", "utf8"));
const ROUTES = {
  manager: ["/command", "/dashboard", "/planning", "/eod-tasks", "/team-capacity", "/workload", "/reviews", "/tasks", "/executive", "/time-tracking", "/notifications", "/manager", "/calendar"],
  member: ["/my-day", "/today", "/tasks", "/calendar", "/notifications", "/eod", "/leaves", "/notebook"],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ channel: "msedge", headless: true });
const result = {};
for (const role of ["manager", "member"]) {
  const u = users.find((x) => x.role === role);
  const tok = await (await fetch(KC, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", client_id: "execution-os", username: u.email, password: process.env.LT_PASSWORD }) })).json();
  for (const route of ROUTES[role]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(({ a, r }) => { try { localStorage.setItem("kc_token", a); localStorage.setItem("kc_refresh_token", r); } catch {} }, { a: tok.access_token, r: tok.refresh_token });
    const page = await ctx.newPage();
    const rec = [];
    page.on("requestfinished", async (rq) => {
      const x = new URL(rq.url());
      if (x.pathname.startsWith("/assets") || x.pathname.endsWith(".svg")) return;
      let s = null; try { s = await rq.sizes(); } catch {}
      rec.push({ m: rq.method(), k: x.port === "7051" ? "api" : x.port === "7052" ? "auth" : x.pathname.startsWith("/socket.io") ? "sio" : "app", p: x.pathname, q: x.search.slice(0, 300), down: (s?.responseHeadersSize ?? 0) + (s?.responseBodySize ?? 0), up: (s?.requestHeadersSize ?? 0) + (s?.requestBodySize ?? 0) });
    });
    await page.goto(APP + route, { waitUntil: "load", timeout: 30000 }).catch(() => {});
    await sleep(IDLE);
    result[`${role}:${route}`] = rec;
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(OUT, JSON.stringify(result));
console.log("probe done", Object.keys(result).length);

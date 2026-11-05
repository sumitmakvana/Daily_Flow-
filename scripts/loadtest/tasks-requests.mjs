#!/usr/bin/env node
/** Lists every REST request the Tasks page sends for one manager (method, resource, status, bytes) on a cold load. */
import { chromium } from "playwright-core";
import fs from "node:fs";
const APP = process.env.APP_URL || "http://localhost:7050";
const KC = "http://localhost:7052/realms/lovable/protocol/openid-connect/token";
const users = JSON.parse(fs.readFileSync("scripts/loadtest/users.local.json", "utf8"));
const u = users.find((x) => x.role === (process.env.ROLE || "manager"));
const tok = await (await fetch(KC, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", client_id: "execution-os", username: u.email, password: process.env.LT_PASSWORD }) })).json();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(({ a, r }) => { try { localStorage.setItem("kc_token", a); localStorage.setItem("kc_refresh_token", r); } catch {} }, { a: tok.access_token, r: tok.refresh_token });
const page = await ctx.newPage();
const rows = [];
page.on("requestfinished", async (rq) => {
  const x = new URL(rq.url());
  if (x.port !== "7051") return;
  let s = null; try { s = await rq.sizes(); } catch {}
  const rs = await rq.response().catch(() => null);
  rows.push({ m: rq.method(), p: x.pathname.replace("/rest/v1/", ""), q: decodeURIComponent(x.search).slice(0, 110), s: rs?.status(), down: (s?.responseHeadersSize ?? 0) + (s?.responseBodySize ?? 0) });
});
page.on("requestfailed", (rq) => { const x = new URL(rq.url()); if (x.port === "7051") rows.push({ m: rq.method(), p: x.pathname, q: "FAILED " + rq.failure()?.errorText, s: 0, down: 0 }); });
await page.goto(APP + "/tasks", { waitUntil: "load" });
await page.waitForTimeout(8000);
const t = process.env.ALL ? rows : rows.filter((r) => r.p.startsWith("tasks") || r.p.startsWith("rpc/task_list"));
for (const r of t) console.log(r.m.padEnd(5), r.s, String(r.down).padStart(6) + "B", r.p, r.q);
console.log("TASK-RELATED REQUESTS:", t.length, " bytes:", t.reduce((a, r) => a + r.down, 0), " | ALL API REQUESTS:", rows.length);
await browser.close();

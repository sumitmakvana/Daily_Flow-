#!/usr/bin/env node
/**
 * Creates the load-test accounts on the LOCAL stack by using Keycloak's normal
 * self-registration (the realm has registrationAllowed=true), so no admin
 * credentials are needed. Then sets their roles in the local DB via docker exec.
 *
 *   LT_PASSWORD=... node scripts/loadtest/provision-users.mjs
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const KC = "http://localhost:7052/realms/lovable/protocol/openid-connect";
const REDIRECT = "http://localhost:7050/";
const PASSWORD = process.env.LT_PASSWORD;
if (!PASSWORD) throw new Error("set LT_PASSWORD");
const OUT = process.argv[2] || "scripts/loadtest/users.local.json";

const users = [
  ...Array.from({ length: 5 }, (_, i) => ({ n: `ltmgr${i + 1}`, role: "manager" })),
  ...Array.from({ length: 5 }, (_, i) => ({ n: `ltmem${i + 1}`, role: "member" })),
].map((u) => ({ ...u, email: `${u.n}@loadtest.local` }));

const b64 = (b) => b.toString("base64url");
function jar() {
  const c = new Map();
  return {
    add(res) { for (const s of res.headers.getSetCookie()) { const [kv] = s.split(";"); const i = kv.indexOf("="); c.set(kv.slice(0, i), kv.slice(i + 1)); } },
    header() { return [...c].map(([k, v]) => `${k}=${v}`).join("; "); },
  };
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x3D;/g, "=").replace(/&quot;/g, '"');

// The dumped realm advertises the production hostname; pin every request to the local Keycloak.
function local(u) {
  const x = new URL(u, "http://localhost:7052");
  if (x.hostname !== "localhost") { x.protocol = "http:"; x.host = "localhost:7052"; }
  if (x.hostname !== "localhost") throw new Error("refusing non-local host " + x.host);
  return x.toString();
}

async function follow(url, j, init = {}) {
  url = local(url);
  let res;
  for (let i = 0; i < 10; i++) {
    res = await fetch(url, { ...init, redirect: "manual", headers: { cookie: j.header(), ...(init.headers || {}) } });
    j.add(res);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      if (loc.startsWith(REDIRECT)) return { code: new URL(loc).searchParams.get("code") };
      url = local(new URL(loc, url).toString()); init = {};
    } else break;
  }
  return { res };
}

async function register(u) {
  const verifier = b64(crypto.randomBytes(32));
  const challenge = b64(crypto.createHash("sha256").update(verifier).digest());
  const j = jar();
  const authUrl = `${KC}/auth?client_id=execution-os&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&scope=openid&code_challenge=${challenge}&code_challenge_method=S256`;
  let { res } = await follow(authUrl, j);
  let html = await res.text();
  const reg = html.match(/href="([^"]*login-actions\/registration[^"]*)"/);
  if (!reg) throw new Error("no registration link on login page");
  ({ res } = await follow(new URL(decode(reg[1]), "http://localhost:7052").toString(), j));
  html = await res.text();
  const action = html.match(/<form[^>]*action="([^"]+)"/)?.[1];
  if (!action) throw new Error("no registration form");
  const body = new URLSearchParams({ username: u.email, email: u.email, firstName: "LoadTest", lastName: u.n, password: PASSWORD, "password-confirm": PASSWORD });
  const r = await follow(new URL(decode(action), "http://localhost:7052").toString(), j, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
  if (!r.code) {
    const t = r.res ? await r.res.text() : "";
    if (/already exists|Username already/i.test(t)) return "exists";
    throw new Error(`registration failed for ${u.n}: ${t.match(/kc-feedback-text">([^<]+)/)?.[1] ?? r.res?.status} ${r.res?.url} ${t.slice(0,200)}`);
  }
  return "created";
}

for (const u of users) console.log(u.n, await register(u).catch((e) => "ERROR " + e.message));

// Resolve ids via a direct-grant login, run ensure_user_profile, then set role.
const sql = [];
for (const u of users) {
  const t = await (await fetch(`${KC}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password", client_id: "execution-os", username: u.email, password: PASSWORD }) })).json();
  if (!t.access_token) { console.log("login failed", u.n, t.error_description); continue; }
  const sub = JSON.parse(Buffer.from(t.access_token.split(".")[1], "base64url")).sub;
  u.id = sub;
  await fetch("http://localhost:7051/rest/v1/rpc/ensure_user_profile", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t.access_token}`, apikey: process.env.LT_ANON_KEY || "" }, body: JSON.stringify({ user_id: sub, user_email: u.email, user_name: u.n }) }).then((r) => console.log("ensure_user_profile", u.n, r.status));
  sql.push(`update public.user_roles set role='${u.role}' where user_id='${sub}';`);
}
execFileSync("docker", ["exec", "-i", "dailyflow-local-postgres-1", "psql", "-U", "postgres", "-d", "dailyflow_test", "-v", "ON_ERROR_STOP=1"], { input: sql.join("\n"), stdio: ["pipe", "inherit", "inherit"] });
fs.writeFileSync(OUT, JSON.stringify(users.map(({ n, role, email, id }) => ({ n, role, email, id })), null, 2));
console.log("wrote", OUT);

#!/usr/bin/env node
/**
 * Simulates "other people" changing data while the load test runs (the local
 * stack denies client-side REST writes because RLS uses auth.uid(), so changes
 * are made directly in the local test DB): every 60-180s it flips the status of
 * a seeded LT-SEED task and inserts a notification for a random load-test user.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const END = Date.now() + Number(process.env.DURATION_MIN || 480) * 60_000;
const OUT = process.env.OUT || "scripts/loadtest/out/run";
const users = JSON.parse(fs.readFileSync("scripts/loadtest/users.local.json", "utf8"));
const psql = (sql) => execFileSync("docker", ["exec", "-i", "dailyflow-local-postgres-1", "psql", "-U", "postgres", "-d", "dailyflow_test", "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8" });
const log = fs.createWriteStream(`${OUT}/activity.jsonl`, { flags: "a" });
const rand = (a, b) => a + Math.random() * (b - a);
let n = 0;
while (Date.now() < END && !fs.existsSync(`${OUT}/STOP`)) {
  n++;
  const u = users[Math.floor(Math.random() * users.length)];
  const status = ["To Do", "In Progress", "Completed"][n % 3];
  try {
    psql(`update tasks set status='${status}', done=${status === "Completed"}, updated_at=now() where task_code = 'LT-SEED-${1 + (n % 20)}';
insert into notifications(user_id,type,title,body,dedupe_key) values('${u.id}','info','Load test notification ${n}','simulated activity','lt-${Date.now()}-${n}');`);
    log.write(JSON.stringify({ t: Date.now(), n, ok: true }) + "\n");
  } catch (e) { log.write(JSON.stringify({ t: Date.now(), n, ok: false, err: String(e).slice(0, 200) }) + "\n"); }
  await new Promise((r) => setTimeout(r, rand(60, 180) * 1000 * Number(process.env.THINK_SCALE || 1)));
}
log.end();

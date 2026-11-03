#!/usr/bin/env node
/** Samples docker stats + Postgres stats every INTERVAL_S seconds into OUT/*.csv. Stops at DURATION_MIN (+2 min) or when OUT/STOP exists. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.OUT || "scripts/loadtest/out/run";
const INTERVAL = Number(process.env.INTERVAL_S || 10) * 1000;
const END = Date.now() + Number(process.env.DURATION_MIN || 480) * 60_000 + 120_000;
fs.mkdirSync(OUT, { recursive: true });
const dock = fs.createWriteStream(path.join(OUT, "docker.csv"), { flags: "a" });
const pg = fs.createWriteStream(path.join(OUT, "pg.csv"), { flags: "a" });
dock.write("t,container,cpu,mem_mb,mem_limit_mb,net_rx_b,net_tx_b,blk_r_b,blk_w_b,pids\n");
pg.write("t,connections,active,db_mb,xact_commit,xact_rollback,blks_read,blks_hit,tup_returned,tup_fetched,tup_inserted,tup_updated,tup_deleted,deadlocks,temp_bytes,locks_waiting,all_backends\n");

const UNITS = { b: 1, kb: 1e3, kib: 1024, mb: 1e6, mib: 1048576, gb: 1e9, gib: 1073741824, tb: 1e12 };
const num = (s) => {
  const m = String(s).trim().match(/^([\d.]+)\s*([a-zA-Z]*)/);
  return m ? parseFloat(m[1]) * (UNITS[m[2].toLowerCase()] ?? 1) : 0;
};
const pair = (s) => s.split("/").map(num);
const Q = `select (select count(*) from pg_stat_activity where datname=current_database()),
 (select count(*) from pg_stat_activity where datname=current_database() and state='active'),
 round(pg_database_size(current_database())/1048576.0,1),
 d.xact_commit,d.xact_rollback,d.blks_read,d.blks_hit,d.tup_returned,d.tup_fetched,d.tup_inserted,d.tup_updated,d.tup_deleted,d.deadlocks,d.temp_bytes,
 (select count(*) from pg_locks where not granted),
 (select count(*) from pg_stat_activity)
 from pg_stat_database d where d.datname=current_database()`.replace(/\n/g, " ");

while (Date.now() < END && !fs.existsSync(path.join(OUT, "STOP"))) {
  const t = Date.now();
  try {
    for (const line of execFileSync("docker", ["stats", "--no-stream", "--format", "{{json .}}"], { encoding: "utf8" }).trim().split("\n")) {
      const s = JSON.parse(line);
      if (!s.Name.startsWith("dailyflow-local")) continue;
      const [mu, ml] = pair(s.MemUsage), [rx, tx] = pair(s.NetIO), [br, bw] = pair(s.BlockIO);
      dock.write([t, s.Name.replace("dailyflow-local-", "").replace(/-1$/, ""), parseFloat(s.CPUPerc), (mu / 1e6).toFixed(1), (ml / 1e6).toFixed(0), Math.round(rx), Math.round(tx), Math.round(br), Math.round(bw), s.PIDs].join(",") + "\n");
    }
  } catch (e) { fs.appendFileSync(path.join(OUT, "monitor-errors.log"), `${t} docker ${e.message.slice(0, 200)}\n`); }
  try {
    const r = execFileSync("docker", ["exec", "dailyflow-local-postgres-1", "psql", "-U", "postgres", "-d", "dailyflow_test", "-At", "-F", ",", "-c", Q], { encoding: "utf8" }).trim();
    pg.write(`${t},${r}\n`);
  } catch (e) { fs.appendFileSync(path.join(OUT, "monitor-errors.log"), `${t} pg ${e.message.slice(0, 200)}\n`); }
  await new Promise((r) => setTimeout(r, Math.max(0, INTERVAL - (Date.now() - t))));
}
dock.end(); pg.end();

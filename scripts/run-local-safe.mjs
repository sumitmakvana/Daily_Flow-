#!/usr/bin/env node
/**
 * Run Operon locally against a database that must NOT be changed (for example an
 * SSH tunnel to production), with every write path disabled.
 *
 *   npm run build:local-safe   # builds into dist-local-safe/ (never touches dist/)
 *   npm run start:local-safe   # starts the built server with OPERON_READ_ONLY=1
 *
 * What read-only mode does is documented in src/lib/read-only-mode.server.ts.
 * This launcher additionally:
 *  - reads .env without overriding variables already set in your shell,
 *  - removes cron/email credentials from the child process so nothing could use them,
 *  - points APP_URL at the local server so nothing posts to another host,
 *  - prints the database target (no password) before starting.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];
const DIST = "dist-local-safe";

if (!["build", "start"].includes(mode)) {
  console.error("usage: node scripts/run-local-safe.mjs <build|start>");
  process.exit(2);
}

// .env never overrides what is already exported in the shell.
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  /* no .env: rely on the shell environment */
}

// `shell` is only needed for `npx` on Windows. It must stay off for node itself:
// with a shell, a path such as "C:\Program Files\nodejs\node.exe" is split at the space.
const run = (cmd, args, env, { shell = false } = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, env, stdio: "inherit", shell });
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
    child.on("exit", (code) => resolve(code ?? 1));
  });

if (mode === "build") {
  console.log(`[local-safe] building read-only client+server into ${DIST}/ (dist/ is not touched)`);
  const code = await run(
    "npx",
    ["vite", "build", "--outDir", DIST],
    { ...process.env, VITE_OPERON_READ_ONLY: "1" },
    { shell: process.platform === "win32" },
  );
  process.exit(code);
}

// ---- start ----
if (!fs.existsSync(path.join(root, DIST, "server", "server.js"))) {
  console.error(`[local-safe] ${DIST}/ not found. Run: npm run build:local-safe`);
  process.exit(1);
}
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("[local-safe] DATABASE_URL is not set (put it in .env or export it).");
  process.exit(1);
}
let target = "(unparseable DATABASE_URL)";
try {
  const u = new URL(dbUrl);
  target = `${u.hostname}:${u.port || 5432}${u.pathname}  (user ${decodeURIComponent(u.username)})`;
} catch {
  /* keep placeholder */
}

const port = process.env.PORT || "7050";
const env = {
  ...process.env,
  OPERON_READ_ONLY: "1",
  OPERON_DIST_DIR: DIST,
  PORT: port,
  APP_URL: `http://localhost:${port}`,
};
// Defense in depth: nothing in the child can send email or call a cron hook.
for (const k of [
  "CRON_SECRET",
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM",
  "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_SENDER_EMAIL",
]) {
  delete env[k];
}

console.log(`
[local-safe] READ-ONLY local run
  database      : ${target}
  listening on  : http://localhost:${port}   (Socket.IO at /socket.io)
  DB sessions   : read-only at the database level (default_transaction_read_only=on)
  disabled      : cron ticker, listener DDL, email dispatch, outbound HTTP writes
  stripped env  : CRON_SECRET, SMTP_*, MS_*, EMAIL_FROM
  browser build : non-GET requests refused, no profile write at login
  polling       : unchanged (still enabled)
`);
// --dry-run: show what the child would get, without starting anything.
if (process.argv.includes("--dry-run")) {
  const sensitive = ["CRON_SECRET", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM",
    "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_SENDER_EMAIL"];
  console.log("[local-safe] dry run — child environment check:");
  console.log("  OPERON_READ_ONLY =", env.OPERON_READ_ONLY, "| OPERON_DIST_DIR =", env.OPERON_DIST_DIR, "| APP_URL =", env.APP_URL);
  console.log("  sensitive variables still present in child:", sensitive.filter((k) => k in env).join(", ") || "none");
  process.exit(0);
}

process.exit(await run(process.execPath, ["runner.js"], env));

#!/usr/bin/env node
/**
 * Socket.IO smoke test for a running Operon server (local or behind Nginx).
 *
 *   KC_TOKEN=<keycloak access token> node scripts/realtime-smoke.mjs [--url http://localhost:7050] [--watch 120]
 *
 * Get a token from a signed-in browser tab: DevTools > Application > Local
 * Storage > kc_token. Put it in an environment variable; this script never
 * prints it and never accepts it as a command-line argument.
 *
 * Checks (read-only; it only connects and listens):
 *  1. server answers the Socket.IO polling handshake and advertises websocket
 *  2. a connection WITHOUT a token is rejected
 *  3. a connection with a garbage token is rejected
 *  4. a valid token connects, and upgrades from polling to WebSocket
 *  5. auth:refresh with the same token is accepted
 *  6. a forced transport drop auto-reconnects
 *  --watch <seconds>: stay connected, log connect/disconnect/reconnect with
 *     timestamps, and print the SHAPE (table, event type, id) of every
 *     entity:changed / notification:new event. Restart the server meanwhile to
 *     watch it reconnect.
 */
import { io } from "socket.io-client";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const URL_ = opt("--url", "http://localhost:7050");
const WATCH = Number(opt("--watch", "0"));
const TOKEN = process.env.KC_TOKEN || "";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 23);

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const skipped = (name, why) => { skip++; console.log(`SKIP  ${name}  — ${why}`); };

function connect(token, extra = {}) {
  return io(URL_, { path: "/socket.io", auth: token === null ? {} : { token }, reconnection: false, timeout: 8000, ...extra });
}
const settle = (s) => new Promise((res) => {
  s.once("connect", () => res({ connected: true }));
  s.once("connect_error", (e) => res({ connected: false, error: e.message }));
});

console.log(`Target: ${URL_}   token: ${TOKEN ? "provided (hidden)" : "NOT provided"}\n`);

// 1. handshake over plain HTTP polling
try {
  const r = await fetch(`${URL_}/socket.io/?EIO=4&transport=polling`);
  const body = await r.text();
  const info = JSON.parse(body.slice(body.indexOf("{")));
  ok("polling handshake answered", r.status === 200 && !!info.sid, `HTTP ${r.status}`);
  ok("server advertises websocket upgrade", Array.isArray(info.upgrades) && info.upgrades.includes("websocket"), `upgrades=${JSON.stringify(info.upgrades)}`);
} catch (e) {
  ok("polling handshake answered", false, e.message + "  (is the server running at --url?)");
}

// 2 + 3. rejections
{
  const s = connect(null);
  const r = await settle(s);
  ok("no token is rejected", !r.connected && r.error === "unauthorized", r.error ?? "connected!");
  s.close();
}
{
  const s = connect("not.a.jwt");
  const r = await settle(s);
  ok("garbage token is rejected", !r.connected && r.error === "unauthorized", r.error ?? "connected!");
  s.close();
}

if (!TOKEN) {
  skipped("valid token connects", "set KC_TOKEN to run the authenticated checks");
  skipped("WebSocket upgrade", "needs KC_TOKEN");
  skipped("auth:refresh", "needs KC_TOKEN");
  skipped("forced reconnect", "needs KC_TOKEN");
} else {
  const s = connect(TOKEN, { reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 2000 });
  const events = [];
  s.on("entity:changed", (p) => events.push(`${ts()} entity:changed  ${p.table} ${p.eventType}${p.bulk ? " (bulk)" : ""} id=${p.new?.id ?? p.old?.id ?? "-"}`));
  s.on("notification:new", (p) => events.push(`${ts()} notification:new  id=${p?.id ?? "-"}`));
  const first = await settle(s);
  ok("valid token connects", first.connected, first.error ?? `socket id ${s.id}`);

  if (first.connected) {
    // 4. upgrade polling -> websocket
    const t0 = Date.now();
    while (s.io.engine.transport.name !== "websocket" && Date.now() - t0 < 6000) await wait(100);
    const transport = s.io.engine.transport.name;
    ok("upgraded to WebSocket", transport === "websocket", `transport=${transport}` + (transport !== "websocket" ? "  (proxy not forwarding Upgrade headers?)" : ""));

    // 5. refresh
    const ack = await new Promise((res) => s.timeout(5000).emit("auth:refresh", TOKEN, (err, r) => res(err ? { ok: false, err: err.message } : r)));
    ok("auth:refresh accepted", ack?.ok === true, JSON.stringify(ack));

    // 6. forced drop -> auto-reconnect
    const reconnected = new Promise((res) => s.once("connect", () => res(true)));
    s.io.engine.close(); // simulate a network drop
    const back = await Promise.race([reconnected, wait(10000).then(() => false)]);
    ok("auto-reconnects after a dropped connection", back === true, back ? `reconnected, socket id ${s.id}` : "no reconnect within 10s");

    if (WATCH > 0) {
      console.log(`\nWatching for ${WATCH}s. Restart the server now to test reconnect. Ctrl+C to stop.\n`);
      s.on("disconnect", (reason) => console.log(`${ts()} disconnected (${reason})`));
      s.io.on("reconnect_attempt", (n) => console.log(`${ts()} reconnect attempt #${n}`));
      s.on("connect", () => console.log(`${ts()} connected (socket ${s.id}, transport ${s.io.engine.transport.name})`));
      s.on("connect_error", (e) => console.log(`${ts()} connect_error: ${e.message}`));
      s.on("auth:expired", () => console.log(`${ts()} server says token expired — get a fresh KC_TOKEN`));
      const end = Date.now() + WATCH * 1000;
      let shown = 0;
      while (Date.now() < end) {
        await wait(500);
        while (shown < events.length) console.log(events[shown++]);
      }
      console.log(`\nWatch finished. Events seen: ${events.length}`);
    }
  }
  s.close();
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);

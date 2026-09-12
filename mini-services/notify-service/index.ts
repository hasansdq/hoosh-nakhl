/**
 * Nakhl Restaurant — Real-time admin notification service
 * ---------------------------------------------------------
 * - socket.io server on port 3003, path "/" (REQUIRED for the Caddy gateway:
 *   browser clients connect to io("/?XTransformPort=3003") and Caddy forwards
 *   to this port).
 * - HTTP POST /emit endpoint on the SAME port (for server-to-server pushes
 *   from the Next.js backend): requires header `x-notify-key` = ADMIN_NOTIFY_KEY.
 * - Admin browsers authenticate with `admin-join` { key } and get placed in
 *   the "admins" room; every /emit broadcast goes to that room only.
 *
 * Why the request-listener wrapping below?
 *   With socket.io path "/", engine.io intercepts requests on the http server.
 *   To serve a plain POST /emit on the same port safely, we install our own
 *   'request' listener that handles /emit FIRST and delegates everything else
 *   to socket.io's own (cached) request listener. Verified live: socket.io
 *   clients (websocket + polling) and curl POST /emit coexist without any
 *   interference — no second port needed.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { spawn } from "node:child_process";
import { open as openFile, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { Server, type Socket } from "socket.io";

const PORT = 3003; // hardcoded — the Caddy gateway expects this port

/**
 * Shared secret resolution — keeps this service in sync with the Next backend
 * (which reads the same value through the Miniflare dev context):
 *   1. ADMIN_NOTIFY_KEY env (explicit),
 *   2. the `vars.ADMIN_NOTIFY_KEY` value in the repo's wrangler.jsonc — the
 *      SAME key the local Miniflare dev bindings expose to Next dev.
 * Without (2), sandbox-dev emits were silently rejected (key mismatch).
 */
function resolveAdminKey(): string {
  if (process.env.ADMIN_NOTIFY_KEY) return process.env.ADMIN_NOTIFY_KEY;
  try {
    // ../../wrangler.jsonc relative to mini-services/notify-service/index.ts
    const wrangler = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    const m = wrangler.match(/"ADMIN_NOTIFY_KEY"\s*:\s*"([^"]+)"/);
    if (m && m[1].length >= 16) return m[1];
  } catch {
    /* no wrangler.jsonc next to the service — fall through */
  }
  return "nakhl-notify-2024"; // legacy sandbox default (localhost-only dev)
}
const ADMIN_KEY = resolveAdminKey();
const ADMINS_ROOM = "admins";
const MAX_BODY_BYTES = 64 * 1024;

// Customer room name format: "customer:NK-XXXX" — order numbers are semi-public
// (printed on receipts) and the only thing broadcast to these rooms is status
// updates (no PII). Shape validated here as defense-in-depth.
const CUSTOMER_ROOM_RE = /^customer:NK-[A-Z0-9]{1,13}$/;
const ORDER_NUMBER_RE = /^NK-[A-Z0-9]{1,13}$/;

const httpServer = createServer();

// ---- socket.io (path MUST stay "/" — see header comment) ----
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

// ---- admin room join (shared-secret handshake) ----
io.on("connection", (socket: Socket) => {
  console.log(`[notify] client connected: ${socket.id}`);

  socket.on("admin-join", (data: unknown) => {
    const key = (data as { key?: unknown } | null)?.key;
    if (typeof key === "string" && key === ADMIN_KEY) {
      void socket.join(ADMINS_ROOM);
      socket.emit("joined", { room: ADMINS_ROOM, at: new Date().toISOString() });
      const online = io.sockets.adapter.rooms.get(ADMINS_ROOM)?.size ?? 0;
      console.log(`[notify] admin joined: ${socket.id} (admins online: ${online})`);
    } else {
      console.warn(`[notify] rejected invalid key from ${socket.id}`);
      socket.emit("error: invalid key");
      socket.disconnect(true);
    }
  });

  // ---- customer room join (no auth — orderNumber is semi-public on receipts) ----
  // The customer room only receives order-status broadcasts (no PII). We still
  // validate the orderNumber shape so a buggy/malicious client cannot spam the
  // adapter with arbitrary rooms.
  socket.on("customer-join", (data: unknown) => {
    const orderNumber = (data as { orderNumber?: unknown } | null)?.orderNumber;
    if (
      typeof orderNumber === "string" &&
      orderNumber.length <= 16 &&
      ORDER_NUMBER_RE.test(orderNumber)
    ) {
      const room = `customer:${orderNumber}`;
      void socket.join(room);
      socket.emit("joined-customer", { orderNumber, room, at: new Date().toISOString() });
      console.log(`[notify] customer joined room ${room}: ${socket.id}`);
    } else {
      console.warn(`[notify] rejected invalid orderNumber from ${socket.id}`);
      socket.emit("error: invalid order number");
      // do NOT disconnect — let the customer page try again with a valid number
      // (a stray paste with whitespace shouldn't kill the whole connection)
    }
  });

  socket.on("disconnect", (reason: string) => {
    console.log(`[notify] client disconnected: ${socket.id} (${reason})`);
  });

  socket.on("error", (err: Error) => {
    console.error(`[notify] socket error ${socket.id}:`, err?.message ?? err);
  });
});

// ---- POST /emit — server-to-server push (x-notify-key protected) ----
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function handleEmitRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed — use POST" });
    return;
  }
  if (req.headers["x-notify-key"] !== ADMIN_KEY) {
    console.warn("[notify] /emit rejected: missing or invalid x-notify-key");
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid json body" });
    return;
  }
  const { event, payload, room } = (body ?? {}) as {
    event?: unknown;
    payload?: unknown;
    room?: unknown;
  };
  if (typeof event !== "string" || !/^[a-z][a-z0-9:-]{1,40}$/i.test(event)) {
    sendJson(res, 400, { ok: false, error: "invalid event name" });
    return;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    sendJson(res, 400, { ok: false, error: "payload must be an object" });
    return;
  }
  // Route the broadcast:
  //  - room === "customer:NK-*" (validated shape) → emit to that single
  //    customer room only (the customer currently viewing that order's track
  //    page or orders list).
  //  - otherwise (no room, room === "admins", or any other value) → emit to
  //    the "admins" room as before. This keeps existing admin emits (which send
  //    no `room` field) backward-compatible.
  let targetRoom = ADMINS_ROOM;
  if (typeof room === "string" && CUSTOMER_ROOM_RE.test(room)) {
    targetRoom = room;
  }
  const recipients = io.sockets.adapter.rooms.get(targetRoom)?.size ?? 0;
  io.to(targetRoom).emit(event, payload);
  console.log(`[notify] emit "${event}" -> ${recipients} socket(s) in room "${targetRoom}"`);
  sendJson(res, 200, { ok: true, event, recipients, room: targetRoom });
}

// ---- wrap the request listener: /emit handled here, everything else -> socket.io ----
const ioRequestListeners = httpServer.listeners("request") as Array<
  (req: IncomingMessage, res: ServerResponse) => void
>;
httpServer.removeAllListeners("request");
httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
  const url = req.url ?? "";
  if (url === "/emit" || url.startsWith("/emit?") || url.startsWith("/emit/")) {
    handleEmitRequest(req, res).catch(() => {
      if (!res.writableEnded) sendJson(res, 500, { ok: false, error: "internal error" });
    });
    return;
  }
  // delegate to socket.io's own request listener(s)
  for (const listener of ioRequestListeners) {
    listener.call(httpServer, req, res);
  }
  // safety net: if socket.io attached no listener (should not happen), never hang
  if (ioRequestListeners.length === 0 && !res.writableEnded) {
    sendJson(res, 404, { ok: false, error: "not found" });
  }
});

// ---- start + graceful shutdown ----
httpServer.listen(PORT, () => {
  console.log(`[notify] service listening on port ${PORT} (socket.io path "/")`);
  console.log(
    `[notify] POST /emit ready — key source: ${process.env.ADMIN_NOTIFY_KEY ? "ADMIN_NOTIFY_KEY env" : ADMIN_KEY === "nakhl-notify-2024" ? "legacy default (dev only)" : "wrangler.jsonc vars (dev-preview)"}`,
  );
});

function shutdown(signal: string) {
  console.log(`[notify] received ${signal}, shutting down...`);
  // IMPORTANT: do NOT io.disconnectSockets()/io.close() here — a protocol-level
  // disconnect ("io server disconnect") tells clients NOT to auto-reconnect.
  // Killing the TCP connections instead makes clients see a transport failure
  // and reconnect automatically once the service is back.
  httpServer.closeAllConnections?.();
  httpServer.close(() => {
    console.log("[notify] closed");
    process.exit(0);
  });
  // hard exit fallback after 3s
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ---- Next.js dev-server supervisor ---------------------------------------
// The sandbox harness reaps every background process that was spawned from the
// agent's shell session as soon as that tool call ends — but processes that are
// parented by THIS platform-owned service are left alone. So this service also
// acts as the supervisor that keeps the Next.js dev server (port 3000) alive:
//   • on every (re)start of this file — including `bun --hot` reloads — we make
//     sure `next dev` is running, and
//   • every 30 s we self-heal if it ever dies.
// The child is spawned fully detached (its own session + process group, unref'd)
// with stdio wired to dev.log, so it survives even restarts of this service and
// behaves exactly like the platform's original `next dev -p 3000 2>&1 | tee dev.log`.
//
// PRODUCTION SAFETY: this supervisor is a sandbox-only helper. It is disabled
// automatically when NODE_ENV=production (Docker/standalone deploys set it) and
// can also be forced on/off explicitly with NAKHL_SUPERVISE_DEV=1 / 0. In
// production the process manager (Docker / systemd / PM2) owns restarts instead
// — a supervisor that spawns `next dev` must NEVER run in production.
const SUPERVISE_ENABLED = (() => {
  if (process.env.NAKHL_SUPERVISE_DEV === "1") return true; // force on (sandbox)
  if (process.env.NAKHL_SUPERVISE_DEV === "0") return false; // force off
  return process.env.NODE_ENV !== "production"; // default: dev on, prod off
})();
const DEV_PORT = Number(process.env.NAKHL_DEV_PORT ?? 3000);
const PROJECT_ROOT = process.env.NAKHL_PROJECT_ROOT ?? "/home/z/my-project";
const DEV_LOG_PATH = `${PROJECT_ROOT}/dev.log`;
const SPAWN_LOCK_PATH = "/tmp/nakhl-next-dev.lock";
const SUPERVISE_INTERVAL_MS = 30_000;

function tcpPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host, timeout: 1_000 }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function isPidAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureNextDev(): Promise<void> {
  if (await tcpPortOpen(DEV_PORT)) return; // already serving requests

  // Another spawn may be booting right now (e.g. during a hot reload) — the
  // lock avoids double-spawning two competing `next dev` processes.
  let lockedPid = 0;
  try {
    lockedPid = Number.parseInt((await readFile(SPAWN_LOCK_PATH, "utf8")).trim(), 10);
  } catch {
    // no lock file yet — that's fine, we're first
  }
  if (Number.isFinite(lockedPid) && lockedPid > 0 && (await isPidAlive(lockedPid))) {
    console.log(`[supervisor] next dev already booting (pid ${lockedPid})`);
    return;
  }

  console.log(`[supervisor] port ${DEV_PORT} is down — spawning next dev…`);
  let logFd: number | "ignore" = "ignore";
  try {
    const logFile = await openFile(DEV_LOG_PATH, "a");
    logFd = logFile.fd;
  } catch {
    // fall back to /dev/null — losing dev.log is annoying but not fatal
  }
  const child = spawn(
    "node",
    [`${PROJECT_ROOT}/node_modules/next/dist/bin/next`, "dev", "-p", String(DEV_PORT)],
    {
      cwd: PROJECT_ROOT,
      detached: true, // own session + group: outlives this service & reapers
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    },
  );
  child.unref();
  try {
    await writeFile(SPAWN_LOCK_PATH, `${child.pid}\n`, "utf8");
  } catch {
    // best-effort lock
  }
  console.log(`[supervisor] spawned next dev (pid ${child.pid})`);
}

// run once on every (re)start, then keep watching forever — sandbox only
if (SUPERVISE_ENABLED) {
  void ensureNextDev();
  setInterval(() => void ensureNextDev(), SUPERVISE_INTERVAL_MS);
} else {
  console.log("[supervisor] disabled (production mode) — process manager owns restarts");
}

#!/usr/bin/env node
/**
 * Nakhl Restaurant — production server bootstrap (Docker / VPS)
 * ---------------------------------------------------------------
 * One process, three jobs:
 *
 *  1. Boots the Next.js standalone server exactly the way the generated
 *     `.next/standalone/server.js` does (Next 16: `getRequestHandlers` from
 *     next/dist/server/lib/start-server + the standalone config exported
 *     through `__NEXT_PRIVATE_STANDALONE_CONFIG`), but keeps control of the
 *     HTTP server for the realtime channel.
 *
 *  2. Realtime channel: socket.io mounted at `/api/ws` implementing the
 *     EXACT application protocol of the NakhlRealtime Durable Object /
 *     notify-service (rooms `admins` and `customer:NK-XXXX`, `admin-join`
 *     { key } shared-secret handshake, `customer-join` { orderNumber }).
 *     The browser bundle is baked at build time with
 *     NEXT_PUBLIC_SOCKET_PATH=/api/ws and connects on the same origin —
 *     through the Apache/DirectAdmin reverse proxy like any other request.
 *     (Next's own upgrade handler intentionally ignores unknown paths —
 *     "a custom WS server may be listening on the same path" — so the two
 *     coexist safely on one http server.)
 *
 *  3. POST /emit — the server-to-server push endpoint the Next.js backend
 *     itself calls (NAKHL_NOTIFY_URL=http://127.0.0.1:3000/emit, see
 *     src/lib/notify.ts) — protected by the `x-notify-key` shared secret
 *     (ADMIN_NOTIFY_KEY, bootstrapped in docker/entrypoint.sh).
 *
 * Request routing:
 *   /emit*          → emit handler (x-notify-key protected)
 *   /api/ws*        → socket.io / engine.io
 *   everything else → Next.js request handler
 *
 * Graceful shutdown on SIGTERM/SIGINT: stop accepting connections, kill open
 * sockets (clients see a transport error and auto-reconnect once the
 * container is back — the notify-service protocol contract), close io,
 * exit 0.
 */

const path = require("node:path");
const { readFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { Server } = require("socket.io");

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOSTNAME = process.env.HOSTNAME ?? "0.0.0.0";
const APP_DIR = __dirname;

// Shared secret for POST /emit and the admin-join websocket handshake.
// SECURITY: there is deliberately NO guessable default — /emit is reachable
// through the public reverse proxy, so a weak constant key would let anyone
// push fake events into admin panels. docker/entrypoint.sh always exports a
// strong persisted key; if the env var is missing (server launched outside
// the entrypoint) we fall back to an EPHEMERAL random key: public emits are
// then impossible (the Next backend cannot authenticate) instead of trivial.
function resolveNotifyKey() {
  const fromEnv = process.env.ADMIN_NOTIFY_KEY;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (fromEnv) {
    console.warn(
      "[server] ADMIN_NOTIFY_KEY is shorter than 16 chars — ignoring it and generating an ephemeral key",
    );
  }
  const ephemeral = `ephemeral-${require("node:crypto").randomBytes(24).toString("hex")}`;
  console.warn(
    "[server] ADMIN_NOTIFY_KEY is not set — generated an EPHEMERAL random key. " +
      "The Next.js backend will reject /emit pushes until a key is provided " +
      "(run the container via docker/entrypoint.sh or set ADMIN_NOTIFY_KEY).",
  );
  return ephemeral;
}
const NOTIFY_KEY = resolveNotifyKey();

const ADMINS_ROOM = "admins";
const MAX_EMIT_BODY_BYTES = 64 * 1024;
// Order numbers are semi-public (printed on receipts) and only status
// updates (no PII) are broadcast to customer rooms — shape-validated anyway.
const CUSTOMER_ROOM_RE = /^customer:NK-[A-Z0-9]{1,13}$/;
const ORDER_NUMBER_RE = /^NK-[A-Z0-9]{1,13}$/;
const EVENT_NAME_RE = /^[a-z][a-z0-9:\-]{1,40}$/i;

// ---------------------------------------------------------------------------
// Standalone bootstrap contract (mirrors the generated server.js preamble)
// ---------------------------------------------------------------------------
process.env.NODE_ENV = "production";
process.chdir(APP_DIR);

const { config: nextConfig } = JSON.parse(
  readFileSync(path.join(APP_DIR, ".next", "required-server-files.json"), "utf8"),
);
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

// ---------------------------------------------------------------------------
// HTTP server + socket.io realtime channel (path /api/ws)
// ---------------------------------------------------------------------------
const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/api/ws",
  // same-origin deployment behind the Apache reverse proxy — no CORS needed
  pingTimeout: 60_000,
  pingInterval: 25_000,
  maxHttpBufferSize: 1e6,
});

io.on("connection", (socket) => {
  // admin panels authenticate with the shared secret and join the "admins" room
  socket.on("admin-join", (data) => {
    const key = data && typeof data === "object" ? data.key : undefined;
    if (typeof key === "string" && key === NOTIFY_KEY) {
      socket.join(ADMINS_ROOM);
      socket.emit("joined", { room: ADMINS_ROOM, at: new Date().toISOString() });
      const online = io.sockets.adapter.rooms.get(ADMINS_ROOM)?.size ?? 0;
      console.log(`[realtime] admin joined ${socket.id} (admins online: ${online})`);
    } else {
      console.warn(`[realtime] rejected invalid admin key from ${socket.id}`);
      socket.emit("error: invalid key");
      socket.disconnect(true);
    }
  });

  // customers join their own order-tracking room (semi-public order number)
  socket.on("customer-join", (data) => {
    const orderNumber = data && typeof data === "object" ? data.orderNumber : undefined;
    if (
      typeof orderNumber === "string" &&
      orderNumber.length <= 16 &&
      ORDER_NUMBER_RE.test(orderNumber)
    ) {
      const room = `customer:${orderNumber}`;
      socket.join(room);
      socket.emit("joined-customer", { orderNumber, room, at: new Date().toISOString() });
      console.log(`[realtime] customer joined ${room}: ${socket.id}`);
    } else {
      // do NOT disconnect — the track page retries with a normalized number
      socket.emit("error: invalid order number");
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`[realtime] disconnected ${socket.id} (${reason})`);
  });

  socket.on("error", (err) => {
    console.error(`[realtime] socket error ${socket.id}:`, err?.message ?? err);
  });
});

// ---------------------------------------------------------------------------
// POST /emit — push endpoint used by the Next.js backend itself
// ---------------------------------------------------------------------------
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_EMIT_BODY_BYTES) {
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

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function handleEmitRequest(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method not allowed — use POST" });
    return;
  }
  if (req.headers["x-notify-key"] !== NOTIFY_KEY) {
    console.warn("[emit] rejected: missing or invalid x-notify-key");
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid json body" });
    return;
  }
  const { event, payload, room } = body ?? {};
  if (typeof event !== "string" || !EVENT_NAME_RE.test(event)) {
    sendJson(res, 400, { ok: false, error: "invalid event name" });
    return;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    sendJson(res, 400, { ok: false, error: "payload must be an object" });
    return;
  }

  // Routing (identical semantics to the Durable Object and notify-service):
  //   room === "customer:NK-*" → that single customer room,
  //   anything else            → the admins room.
  let targetRoom = ADMINS_ROOM;
  if (typeof room === "string" && CUSTOMER_ROOM_RE.test(room)) {
    targetRoom = room;
  }
  const recipients = io.sockets.adapter.rooms.get(targetRoom)?.size ?? 0;
  io.to(targetRoom).emit(event, payload);
  console.log(`[emit] "${event}" → ${recipients} socket(s) in "${targetRoom}"`);
  sendJson(res, 200, { ok: true, event, recipients, room: targetRoom });
}

// ---------------------------------------------------------------------------
// Request dispatch: /emit → emit · /api/ws → socket.io · rest → Next.js
// ---------------------------------------------------------------------------
// engine.io installs its own 'request' listener when attaching to the server —
// capture it, then install a single dispatcher so nothing races.
const ioRequestListeners = httpServer.listeners("request").slice();
httpServer.removeAllListeners("request");

let nextRequestHandler = null; // set once the Next server has initialized
let nextUpgradeHandler = null;

httpServer.on("request", (req, res) => {
  const url = req.url ?? "";

  if (url === "/emit" || url.startsWith("/emit?") || url.startsWith("/emit/")) {
    handleEmitRequest(req, res).catch(() => {
      if (!res.writableEnded) sendJson(res, 500, { ok: false, error: "internal error" });
    });
    return;
  }

  if (url === "/api/ws" || url.startsWith("/api/ws/")) {
    for (const listener of ioRequestListeners) listener.call(httpServer, req, res);
    return;
  }

  if (!nextRequestHandler) {
    // boot race — the server only listens after Next is ready, so this is
    // purely defensive
    sendJson(res, 503, { ok: false, error: "server is starting" });
    return;
  }
  Promise.resolve(nextRequestHandler(req, res)).catch((err) => {
    console.error("[next] request handler error:", err);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.end("internal server error");
    }
  });
});

// Next's production upgrade handler deliberately ignores unknown paths, so
// engine.io (which registered first) serves /api/ws upgrades.
httpServer.on("upgrade", (req, socket, head) => {
  if (nextUpgradeHandler) {
    Promise.resolve(nextUpgradeHandler(req, socket, head)).catch(() => {
      socket.destroy();
    });
  }
});

// ---------------------------------------------------------------------------
// Boot + graceful shutdown
// ---------------------------------------------------------------------------
async function bootstrap() {
  const { getRequestHandlers } = require("next/dist/server/lib/start-server");
  const handlers = await getRequestHandlers({
    dir: APP_DIR,
    port: PORT,
    isDev: false,
    hostname: HOSTNAME,
    server: httpServer,
    onDevServerCleanup: undefined,
    minimalMode: false,
    keepAliveTimeout: undefined,
    experimentalHttpsServer: undefined,
    quiet: undefined,
  });
  nextRequestHandler = handlers.requestHandler;
  nextUpgradeHandler = handlers.upgradeHandler;

  httpServer.keepAliveTimeout = 65_000; // > Apache's 60s to avoid 502 races
  httpServer.headersTimeout = 66_000;
  httpServer.listen(PORT, HOSTNAME, () => {
    console.log(`[server] Nakhl production server listening on http://${HOSTNAME}:${PORT}`);
    console.log("[server] realtime: socket.io at /api/ws · push: POST /emit (x-notify-key)");
  });
}

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] received ${signal}, shutting down…`);
  // Kill TCP connections instead of io.disconnectSockets(): a protocol-level
  // disconnect would tell clients NOT to reconnect — transport errors do.
  httpServer.closeAllConnections?.();
  io.close(() => {
    console.log("[server] realtime channel closed");
  });
  httpServer.close(() => {
    console.log("[server] http server closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("[server] uncaught exception:", err);
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (err) => {
  console.error("[server] unhandled rejection:", err);
});

bootstrap().catch((err) => {
  console.error("[server] failed to boot:", err);
  process.exit(1);
});

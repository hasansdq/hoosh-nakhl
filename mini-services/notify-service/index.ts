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
import { Server, type Socket } from "socket.io";

const PORT = 3003; // hardcoded — the Caddy gateway expects this port
const ADMIN_KEY = process.env.ADMIN_NOTIFY_KEY ?? "nakhl-notify-2024";
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
  console.log(`[notify] POST /emit ready — key source: ${process.env.ADMIN_NOTIFY_KEY ? "ADMIN_NOTIFY_KEY env" : "default fallback"}`);
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

/**
 * Nakhl Restaurant — realtime notification Durable Object
 * --------------------------------------------------------
 * Replaces the sandbox Socket.IO notify-service (mini-services/notify-service)
 * with a Cloudflare-native equivalent that preserves the exact application
 * protocol:
 *
 *  • Browser clients connect via WebSocket to `/api/ws` (upgrades are routed
 *    to this object by src/worker.js before entering Next.js).
 *  • First message after connect: `admin-join` { key } → joins the "admins"
 *    room (shared-secret handshake, identical to the Socket.IO service) or
 *    `customer-join` { orderNumber } → joins `customer:NK-XXXX`.
 *  • Server-to-server pushes: the Next.js backend calls this object via the
 *    REALTIME namespace binding (see src/lib/notify.ts) with an
 *    `x-notify-key` protected POST /emit { event, payload, room? }.
 *  • Broadcasts fan out to the target room only — admins receive every
 *    event, customers only status updates for their own order.
 *
 * Wire protocol (JSON text frames):
 *   client → server: { "event": "admin-join"|"customer-join", "data": {...} }
 *   server → client: { "event": "…", "payload": … }
 *
 * Event names are identical to the Socket.IO implementation, so the frontend
 * components (OrdersView / TrackView / AdminPanel) keep working unchanged
 * through the transport adapter in src/lib/realtime.ts.
 *
 * Room membership is held in memory. The Workers runtime keeps this object
 * resident while any WebSocket is open; with zero open connections it may be
 * evicted, which is fine — there is nothing left to deliver at that point.
 */

// Minimal structural types for the Workers runtime APIs used by this object
// (kept local — the ambient @cloudflare/workers-types package is not part of
// this project's tsconfig; see src/lib/cf.ts for the rationale).
interface RealtimeDurableObjectState {
  readonly id: { readonly name?: string; readonly id: string };
}

declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket };

interface RealtimeEnv {
  ADMIN_NOTIFY_KEY?: string;
}

interface IncomingClientMessage {
  event?: unknown;
  data?: { key?: unknown; orderNumber?: unknown } | null;
}

interface EmitBody {
  event?: unknown;
  payload?: unknown;
  room?: unknown;
}

/** Room name format for customer tracking: `customer:NK-XXXX` (order numbers are semi-public). */
const CUSTOMER_ROOM_RE = /^customer:NK-[A-Z0-9]{1,13}$/;
const ORDER_NUMBER_RE = /^NK-[A-Z0-9]{1,13}$/;
const EVENT_NAME_RE = /^[a-z][a-z0-9:\-]{1,40}$/i;
const MAX_EMIT_BODY_BYTES = 64 * 1024;
const MIN_NOTIFY_KEY_LENGTH = 16;
const ADMINS_ROOM = "admins";

const OPEN = 1; // WebSocket.readyState OPEN

export class NakhlRealtime {
  private admins = new Set<WebSocket>();
  private customers = new Map<string, Set<WebSocket>>();
  /** lazily generated when no ADMIN_NOTIFY_KEY is configured (fail-closed) */
  private ephemeralKey: string | undefined;

  constructor(
    private readonly state: RealtimeDurableObjectState,
    private readonly env: RealtimeEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/emit") {
      return this.handleEmit(request);
    }

    if (url.pathname === "/health") {
      return this.json(200, {
        ok: true,
        admins: this.admins.size,
        customerRooms: this.customers.size,
      });
    }

    if ((request.headers.get("upgrade") || "").toLowerCase() === "websocket") {
      return this.handleUpgrade();
    }

    return this.json(404, { ok: false, error: "not found" });
  }

  // ---------- WebSocket upgrade ----------

  private handleUpgrade(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.addEventListener("message", (event) => {
      this.handleClientMessage(server, event);
    });
    server.addEventListener("close", () => {
      this.forget(server);
    });
    server.addEventListener("error", () => {
      this.forget(server);
    });
    (server as WebSocket & { accept(): void }).accept();

    // `webSocket` on ResponseInit is the Workers-runtime extension for
    // answering 101 Switching Protocols (not part of the DOM lib types).
    const upgradeInit: ResponseInit & { webSocket?: WebSocket } = {
      status: 101,
      webSocket: client,
    };
    return new Response(null, upgradeInit);
  }

  // ---------- client messages (join handshakes) ----------

  private handleClientMessage(ws: WebSocket, event: MessageEvent): void {
    let message: IncomingClientMessage | null = null;
    try {
      const raw = typeof event.data === "string" ? event.data : "";
      message = JSON.parse(raw) as IncomingClientMessage;
    } catch {
      ws.send(JSON.stringify({ event: "error: invalid message", payload: "messages must be JSON" }));
      return;
    }
    if (!message || typeof message.event !== "string") return;

    if (message.event === "admin-join") {
      const key = message.data?.key;
      if (typeof key === "string" && key === this.notifyKey()) {
        this.admins.add(ws);
        ws.send(
          JSON.stringify({ event: "joined", payload: { room: ADMINS_ROOM, at: new Date().toISOString() } }),
        );
      } else {
        ws.send(JSON.stringify({ event: "error: invalid key", payload: "unauthorized" }));
        // mirror the Socket.IO behaviour: drop the connection on a bad key
        ws.close(1008, "invalid key");
      }
      return;
    }

    if (message.event === "customer-join") {
      const orderNumber = message.data?.orderNumber;
      if (
        typeof orderNumber === "string" &&
        orderNumber.length <= 16 &&
        ORDER_NUMBER_RE.test(orderNumber)
      ) {
        const room = this.customers.get(orderNumber) ?? new Set<WebSocket>();
        room.add(ws);
        this.customers.set(orderNumber, room);
        ws.send(
          JSON.stringify({
            event: "joined-customer",
            payload: { orderNumber, room: `customer:${orderNumber}`, at: new Date().toISOString() },
          }),
        );
      } else {
        // do NOT disconnect — let the customer page retry with a valid number
        ws.send(JSON.stringify({ event: "error: invalid order number", payload: "invalid orderNumber" }));
      }
      return;
    }
  }

  /** Remove a socket from every room it may occupy. */
  private forget(ws: WebSocket): void {
    this.admins.delete(ws);
    for (const [orderNumber, room] of this.customers) {
      room.delete(ws);
      if (room.size === 0) this.customers.delete(orderNumber);
    }
  }

  // ---------- server-to-server emit (x-notify-key protected) ----------

  /**
   * Shared secret for admin-join and /emit.
   * SECURITY: no guessable fallback — with ADMIN_NOTIFY_KEY unset or too
   * short (< 16 chars) a RANDOM per-instance value is used, which makes
   * admin-join and /emit fail closed (nobody can guess it) instead of
   * letting anyone who read the repo join the admins room. Set a real
   * secret in production: `wrangler secret put ADMIN_NOTIFY_KEY`.
   */
  private notifyKey(): string {
    const configured = this.env.ADMIN_NOTIFY_KEY;
    if (configured && configured.length >= MIN_NOTIFY_KEY_LENGTH) return configured;
    if (configured) console.warn("[realtime] ADMIN_NOTIFY_KEY shorter than 16 chars — using an ephemeral random key (admin-join/emit will fail until a real secret is set)");
    this.ephemeralKey ??= `ephemeral-${crypto.randomUUID()}`;
    return this.ephemeralKey;
  }

  private async handleEmit(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return this.json(405, { ok: false, error: "method not allowed — use POST" });
    }
    if (request.headers.get("x-notify-key") !== this.notifyKey()) {
      return this.json(401, { ok: false, error: "unauthorized" });
    }

    let body: EmitBody | null = null;
    try {
      const raw = await request.text();
      if (raw.length > MAX_EMIT_BODY_BYTES) {
        return this.json(400, { ok: false, error: "body too large" });
      }
      body = raw ? (JSON.parse(raw) as EmitBody) : null;
    } catch {
      return this.json(400, { ok: false, error: "invalid json body" });
    }

    const { event, payload, room } = body ?? {};
    if (typeof event !== "string" || !EVENT_NAME_RE.test(event)) {
      return this.json(400, { ok: false, error: "invalid event name" });
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return this.json(400, { ok: false, error: "payload must be an object" });
    }

    // Routing (identical to the Socket.IO service):
    //  room === "customer:NK-*" → that single customer room,
    //  anything else            → the admins room.
    let targetRoom = ADMINS_ROOM;
    let recipients: WebSocket[] = [...this.admins];
    if (typeof room === "string" && CUSTOMER_ROOM_RE.test(room)) {
      targetRoom = room;
      recipients = [...(this.customers.get(room.slice("customer:".length)) ?? [])];
    }

    const frame = JSON.stringify({ event, payload });
    let count = 0;
    for (const ws of recipients) {
      if (ws.readyState === OPEN) {
        ws.send(frame);
        count++;
      }
    }

    return this.json(200, { ok: true, event, recipients: count, room: targetRoom });
  }

  private json(status: number, body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

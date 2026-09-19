/**
 * Nakhl Restaurant — shared realtime connection helper
 * -----------------------------------------------------
 * One place that decides HOW the browser reaches the realtime channel
 * (order-status push, admin notifications):
 *
 *  • Cloudflare Workers build (NEXT_PUBLIC_REALTIME_MODE=workers, baked in
 *    at `bun run cf:build`): native WebSocket to the same origin at
 *    `/api/ws` — upgrades are routed by src/worker.js to the NakhlRealtime
 *    Durable Object. JSON frames: { event, data } up, { event, payload } down.
 *
 *  • Sandbox / local `next dev` (default, no env needed): socket.io-client to
 *    the notify-service — io("/?XTransformPort=3003") through the Caddy
 *    gateway (or io({ path: NEXT_PUBLIC_SOCKET_PATH }) behind a reverse
 *    proxy).
 *
 * Both transports implement the same RealtimeSocket surface
 * (on / emit / disconnect / connected), so OrdersView / TrackView /
 * AdminPanel work unchanged on either backend.
 */
"use client";

import type { Socket } from "socket.io-client";


/**
 * Minimal socket-like surface shared by both transports. Mirrors the subset
 * of the socket.io client API used by the application components
 * (on / emit / connect / removeAllListeners / disconnect / connected).
 */
export interface RealtimeSocket {
  readonly connected: boolean;
  on(event: string, handler: (payload?: any) => void): void;
  emit(event: string, data?: unknown): void;
  /** Re-open the connection after a manual disconnect (socket.io semantics). */
  connect(): void;
  /** Drop all registered handlers (optionally for one event only). */
  removeAllListeners(event?: string): void;
  disconnect(): void;
}

const RECONNECT_DELAY_MS = 2000;

const REALTIME_IO_OPTIONS = {
  transports: ["websocket", "polling"] as ("websocket" | "polling")[],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
};

/** True when the client bundle was built for the Cloudflare Workers deployment. */
const WORKERS_MODE = process.env.NEXT_PUBLIC_REALTIME_MODE === "workers";

export async function connectRealtime(): Promise<RealtimeSocket> {
  if (WORKERS_MODE) {
    return new WebSocketRealtime();
  }
  return connectSocketIo();
}

// ---------------------------------------------------------------------------
// Transport 1 — native WebSocket → NakhlRealtime Durable Object (Workers)
// ---------------------------------------------------------------------------

class WebSocketRealtime implements RealtimeSocket {
  private handlers = new Map<string, Set<(payload?: any) => void>>();
  private ws: WebSocket | null = null;
  private manualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private _connected = false;

  constructor() {
    this.open();
  }

  get connected(): boolean {
    return this._connected;
  }

  private wsUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${window.location.host}/api/ws`;
  }

  private open(): void {
    if (this.disposed) return;
    this.manualClose = false;
    try {
      const ws = new WebSocket(this.wsUrl());
      this.ws = ws;
      ws.onopen = () => {
        this._connected = true;
        this.dispatch("connect");
      };
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const raw = typeof ev.data === "string" ? ev.data : "";
          const frame = JSON.parse(raw) as { event?: unknown; payload?: unknown };
          if (frame && typeof frame.event === "string") {
            this.dispatch(frame.event, frame.payload);
          }
        } catch {
          // malformed frames are ignored — the protocol is JSON text only
        }
      };
      ws.onerror = () => {
        this.dispatch("connect_error", "websocket connection failed");
      };
      ws.onclose = (ev: CloseEvent) => {
        this._connected = false;
        this.dispatch("disconnect", ev.reason || "connection closed");
        if (!this.manualClose && !this.disposed) {
          this.scheduleReconnect();
        }
      };
    } catch {
      // constructing the WebSocket failed (e.g. invalid URL state) — retry
      this.dispatch("connect_error", "websocket unavailable");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.disposed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, RECONNECT_DELAY_MS);
  }

  private dispatch(event: string, payload?: any): void {
    const listeners = this.handlers.get(event);
    if (!listeners) return;
    for (const handler of listeners) {
      try {
        handler(payload);
      } catch {
        // a broken listener must not kill the transport
      }
    }
  }

  on(event: string, handler: (payload?: any) => void): void {
    const listeners = this.handlers.get(event) ?? new Set();
    listeners.add(handler);
    this.handlers.set(event, listeners);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  connect(): void {
    if (this.connected || this.reconnectTimer) return;
    this.disposed = false;
    this.open();
  }

  emit(event: string, data?: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ event, data }));
      } catch {
        // send failures surface as onclose → reconnect
      }
    }
  }

  disconnect(): void {
    this.manualClose = true;
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------
// Transport 2 — socket.io-client → notify-service (sandbox / self-hosted dev)
// ---------------------------------------------------------------------------

async function connectSocketIo(): Promise<RealtimeSocket> {
  const { io } = await import("socket.io-client");

  const customPath = process.env.NEXT_PUBLIC_SOCKET_PATH;
  const socket: Socket = customPath
    ? io({ path: customPath, ...REALTIME_IO_OPTIONS })
    : io("/?XTransformPort=3003", REALTIME_IO_OPTIONS);

  return {
    get connected() {
      return socket.connected;
    },
    on(event, handler) {
      socket.on(event, handler as (...args: unknown[]) => void);
    },
    emit(event, data) {
      socket.emit(event, data);
    },
    connect() {
      socket.connect();
    },
    removeAllListeners(event) {
      socket.removeAllListeners(event);
    },
    disconnect() {
      socket.disconnect();
    },
  };
}

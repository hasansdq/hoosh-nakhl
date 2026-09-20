/**
 * Nakhl Restaurant — shared realtime connection helper
 * -----------------------------------------------------
 * One place that decides HOW the browser reaches the realtime channel
 * (order-status push, admin notifications) — always Socket.IO:
 *
 *  • Local `next dev` (default, no env needed): socket.io-client to the
 *    sandbox notify-service — io("/?XTransformPort=3003") through the Caddy
 *    gateway.
 *
 *  • Docker / VPS (NEXT_PUBLIC_SOCKET_PATH=/api/ws, baked in at
 *    `bun run docker:build`): socket.io-client to the same origin at the
 *    given path — served in-process by docker/app-server.js.
 *
 * The RealtimeSocket surface (on / emit / disconnect / connected) is what
 * OrdersView / TrackView / AdminPanel consume.
 */
"use client";

import type { Socket } from "socket.io-client";


/**
 * Minimal socket-like surface shared by consumers. Mirrors the subset
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

const REALTIME_IO_OPTIONS = {
  transports: ["websocket", "polling"] as ("websocket" | "polling")[],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
};

export async function connectRealtime(): Promise<RealtimeSocket> {
  // socket.io-client is lazily imported (fully client-side, no SSR impact)
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

/**
 * Nakhl Restaurant — shared realtime (socket.io) connection helper
 * ----------------------------------------------------------------
 * One place that decides HOW the browser reaches the notify-service:
 *
 *  • Sandbox / z.ai gateway (default, no env needed):
 *      io("/?XTransformPort=3003") — the Caddy gateway routes the request
 *      (including WebSocket upgrades) to the notify-service by the
 *      XTransformPort query parameter.
 *
 *  • Production (self-hosted with Caddyfile.prod):
 *      set NEXT_PUBLIC_SOCKET_PATH=/rt at BUILD time →
 *      io({ path: "/rt" }) — the reverse proxy routes /rt/* to the
 *      notify-service (prefix stripped), so engine.io endpoints stay on "/".
 *      Works for both polling and WebSocket (wss://domain/rt/).
 *
 * Shared reconnection options keep OrdersView / TrackView / AdminPanel
 * behavior identical everywhere.
 */
"use client";

import type { Socket } from "socket.io-client";

const REALTIME_IO_OPTIONS = {
  transports: ["websocket", "polling"] as ("websocket" | "polling")[],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
};

/** Lazily imports socket.io-client (keeps it fully client-side, no SSR) and connects. */
export async function connectRealtime(): Promise<Socket> {
  const { io } = await import("socket.io-client");

  const customPath = process.env.NEXT_PUBLIC_SOCKET_PATH;
  if (customPath) {
    // production: dedicated reverse-proxy path (e.g. /rt), same-origin
    return io({ path: customPath, ...REALTIME_IO_OPTIONS });
  }

  // sandbox default: route through the gateway via the XTransformPort query
  return io("/?XTransformPort=3003", REALTIME_IO_OPTIONS);
}

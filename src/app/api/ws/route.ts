/**
 * GET /api/ws — realtime notification channel endpoint.
 *
 * WebSocket upgrade requests never reach this route: src/worker.js intercepts
 * them at the worker entry (before OpenNext/Next.js) and forwards them to the
 * NakhlRealtime Durable Object, which answers with 101 Switching Protocols.
 * This route exists so non-upgrade probes get a clear, actionable response
 * and the endpoint shows up in API tooling.
 */
export function GET(request: Request): Response {
  const upgrade = (request.headers.get("upgrade") || "").toLowerCase();
  if (upgrade !== "websocket") {
    return Response.json(
      {
        success: false,
        error:
          "این نقطهٔ اتصال فقط برای WebSocket است — اتصال مرورگر باید با wss/(ws) به /api/ws برقرار شود.",
      },
      { status: 426, headers: { "Upgrade": "websocket" } },
    );
  }
  // Unreachable when src/worker.js is deployed; kept as a safety net for
  // setups where the custom worker entry was bypassed.
  return Response.json(
    { success: false, error: "WebSocket upgrade was not handled by the worker entry" },
    { status: 500 },
  );
}

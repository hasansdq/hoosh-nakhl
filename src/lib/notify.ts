import "server-only";

/**
 * Fire-and-forget push helpers for the notify-service
 * (mini-services/notify-service — socket.io on port 3003).
 *
 * The service hosts two kinds of rooms:
 *  - "admins"            → all connected admin panels (joined via "admin-join" + key)
 *  - "customer:NK-XXXX"  → a customer currently tracking one specific order
 *                          (joined via "customer-join" { orderNumber })
 *
 * Every helper MUST be fire-and-forget: any failure (service down, timeout,
 * bad payload) is swallowed — the main HTTP request flow never breaks.
 */

// Where the notify-service listens. Default: same host (sandbox / VPS with
// systemd). In Docker Compose set NAKHL_NOTIFY_URL=http://notify:3003/emit.
const NOTIFY_EMIT_URL = process.env.NAKHL_NOTIFY_URL ?? "http://localhost:3003/emit";
const NOTIFY_KEY = process.env.ADMIN_NOTIFY_KEY ?? "nakhl-notify-2024";

export async function notifyAdmins(event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(NOTIFY_EMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-notify-key": NOTIFY_KEY,
      },
      body: JSON.stringify({ event, payload }),
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
  } catch {
    // notification failures must never break the main request
  }
}

/**
 * Push a real-time update to the customer currently viewing one specific
 * order (on the /track or /orders page). `orderNumber` must already be in its
 * canonical NK-XXXX form — see src/app/api/orders/track/route.ts for the
 * normalization rules.
 *
 * The payload shape used by callers:
 *   { orderNumber, status, statusLabel, from?, to? }
 */
export async function notifyCustomer(
  orderNumber: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await fetch(NOTIFY_EMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-notify-key": NOTIFY_KEY,
      },
      body: JSON.stringify({ event, payload, room: `customer:${orderNumber}` }),
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
  } catch {
    // notification failures must never break the main request
  }
}

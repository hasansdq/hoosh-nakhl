import "server-only";

/**
 * Fire-and-forget push helpers for the realtime notification channel.
 *
 * Single backend: HTTP POST to the realtime channel's `/emit` endpoint —
 *   • Docker / VPS (production): docker/app-server.js serves socket.io AND
 *     POST /emit in-process; NAKHL_NOTIFY_URL points at it
 *     (http://127.0.0.1:3000/emit, set by docker/entrypoint.sh).
 *   • Local `next dev`: the sandbox notify-service
 *     (mini-services/notify-service — Socket.IO on port 3003).
 *
 * Rooms (identical semantics on both):
 *  - "admins"            → all connected admin panels ("admin-join" + key)
 *  - "customer:NK-XXXX"  → a customer currently tracking one specific order
 *
 * Every helper MUST be fire-and-forget: any failure (channel down, timeout,
 * bad payload) is swallowed — the main HTTP request flow never breaks.
 */

const DEFAULT_NOTIFY_KEY = "nakhl-notify-2024";
const EMIT_URL = process.env.NAKHL_NOTIFY_URL ?? "http://localhost:3003/emit";

interface EmitOptions {
  event: string;
  payload: Record<string, unknown>;
  room?: string;
}

async function emit(opts: EmitOptions): Promise<void> {
  try {
    const key = process.env.ADMIN_NOTIFY_KEY;
    // Production fail-closed rule (Docker sets NAKHL_SQLITE_PATH): a weak or
    // missing key can never authenticate against the channel (which generates
    // an unguessable persistent key via entrypoint/secrets.env) — skip the
    // hop instead of sending a guaranteed-401 request.
    // The weak constant default is kept ONLY for the local sandbox dev path
    // (notify-service on localhost) — never for the Docker runtime.
    if (process.env.NAKHL_SQLITE_PATH && (!key || key.length < 16)) {
      return;
    }
    await fetch(EMIT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-notify-key": key ?? DEFAULT_NOTIFY_KEY,
      },
      body: JSON.stringify({
        event: opts.event,
        payload: opts.payload,
        ...(opts.room ? { room: opts.room } : {}),
      }),
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
  } catch {
    // notification failures must never break the main request
  }
}

export async function notifyAdmins(
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await emit({ event, payload });
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
  payload: Record<string, unknown>,
): Promise<void> {
  await emit({ event, payload, room: `customer:${orderNumber}` });
}

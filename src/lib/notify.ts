import "server-only";

import { getCloudflareEnv } from "@/lib/cf";

/**
 * Fire-and-forget push helpers for the realtime notification channel.
 *
 * Two backends, selected by the same env flag the browser bundle uses
 * (NEXT_PUBLIC_REALTIME_MODE, baked at `bun run cf:build`):
 *
 *  • Cloudflare Workers ("workers"): calls the NakhlRealtime Durable Object
 *    through the REALTIME namespace binding — no HTTP hop, no local service.
 *
 *  • Sandbox / local dev (default): HTTP POST to the notify-service
 *    (mini-services/notify-service — Socket.IO on port 3003), identical to
 *    the previous behaviour. NAKHL_NOTIFY_URL overrides the endpoint
 *    (e.g. http://notify:3003/emit in Docker Compose).
 *
 * Rooms (both backends, identical semantics):
 *  - "admins"            → all connected admin panels ("admin-join" + key)
 *  - "customer:NK-XXXX"  → a customer currently tracking one specific order
 *
 * Every helper MUST be fire-and-forget: any failure (channel down, timeout,
 * bad payload) is swallowed — the main HTTP request flow never breaks.
 */

const DEFAULT_NOTIFY_KEY = "nakhl-notify-2024";
const DO_INSTANCE_NAME = "global";
/** Opaque URL for Durable Object stub.fetch (only the path is meaningful). */
const DO_EMIT_URL = "https://nakhl-realtime/emit";
const LOCAL_EMIT_URL = process.env.NAKHL_NOTIFY_URL ?? "http://localhost:3003/emit";
const WORKERS_MODE = process.env.NEXT_PUBLIC_REALTIME_MODE === "workers";

interface EmitOptions {
  event: string;
  payload: Record<string, unknown>;
  room?: string;
}

async function notifyKey(): Promise<string | null> {
  const env = await getCloudflareEnv();
  const key = env?.ADMIN_NOTIFY_KEY ?? process.env.ADMIN_NOTIFY_KEY;
  // fail-closed: a missing/short key can never authenticate against the DO
  // (which generates an unguessable ephemeral key when unconfigured).
  // The weak constant default is kept ONLY for the local sandbox dev path
  // (notify-service on localhost) — never for the Workers/Docker runtime.
  if (WORKERS_MODE || process.env.NAKHL_SQLITE_PATH) {
    return key && key.length >= 16 ? key : null;
  }
  return key ?? DEFAULT_NOTIFY_KEY;
}

async function emitViaDurableObject(opts: EmitOptions): Promise<void> {
  const env = await getCloudflareEnv();
  const namespace = env?.REALTIME;
  if (!namespace) {
    // Binding missing (misconfigured deploy) — nothing we can do here.
    console.warn("[notify] REALTIME Durable Object binding is not configured");
    return;
  }
  const key = await notifyKey();
  if (!key) {
    // ADMIN_NOTIFY_KEY unset/too short — the DO will reject us anyway; skip
    // the network hop and say so once.
    console.warn("[notify] ADMIN_NOTIFY_KEY is not configured (min 16 chars) — realtime push skipped");
    return;
  }
  const stub = namespace.get(namespace.idFromName(DO_INSTANCE_NAME));
  const response = await stub.fetch(DO_EMIT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-notify-key": key,
    },
    body: JSON.stringify({
      event: opts.event,
      payload: opts.payload,
      ...(opts.room ? { room: opts.room } : {}),
    }),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) {
    console.warn(`[notify] Durable Object emit failed: ${response.status}`);
  }
}

async function emitViaLocalService(opts: EmitOptions): Promise<void> {
  // Docker/VPS path (app-server.js): the same fail-closed rule — a weak or
  // missing key can never authenticate, so skip the hop instead of sending it.
  const key = process.env.ADMIN_NOTIFY_KEY;
  if (process.env.NAKHL_SQLITE_PATH && (!key || key.length < 16)) {
    return;
  }
  await fetch(LOCAL_EMIT_URL, {
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
}

async function emit(opts: EmitOptions): Promise<void> {
  try {
    if (WORKERS_MODE) {
      await emitViaDurableObject(opts);
    } else {
      await emitViaLocalService(opts);
    }
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

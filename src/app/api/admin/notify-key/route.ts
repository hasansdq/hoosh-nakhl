import { ok, fail, requireAdmin } from "@/lib/api";

/**
 * GET /api/admin/notify-key
 * Returns the shared-secret key the admin panel uses to join the
 * real-time notification room (socket.io "admin-join" handshake).
 * The key only grants LISTENING access; emitting requires the
 * server-side x-notify-key header which never leaves the backend.
 *
 * Key source: the ADMIN_NOTIFY_KEY environment variable —
 *   • Docker / VPS: generated once by docker/entrypoint.sh and persisted in
 *     data/secrets.env on the nakhl-data volume (stable across redeploys);
 *   • Local dev: the repo .env file (shared with the notify-service).
 *
 * SECURITY: when no key of at least 16 chars is configured the endpoint
 * returns key=null — the panel then stays on polling notifications instead
 * of authenticating with a guessable default.
 */
export async function GET() {
  const session = await requireAdmin();
  if (!session) return fail("دسترسی غیرمجاز", 401);

  const key = process.env.ADMIN_NOTIFY_KEY ?? "";
  return ok({ key: key.length >= 16 ? key : null });
}

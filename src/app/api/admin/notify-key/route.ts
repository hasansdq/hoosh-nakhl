import { ok, fail, requireAdmin } from "@/lib/api";
import { getCloudflareEnv } from "@/lib/cf";

/**
 * GET /api/admin/notify-key
 * Returns the shared-secret key the admin panel uses to join the
 * real-time notification room (socket.io "admin-join" handshake).
 * The key only grants LISTENING access; emitting requires the
 * server-side x-notify-key header which never leaves the backend.
 *
 * Key resolution order:
 *   1. Cloudflare env (Workers vars/secrets — also the local Miniflare dev
 *      context from wrangler.jsonc),
 *   2. process.env (Docker/VPS container environment).
 *
 * SECURITY: when no key of at least 16 chars is configured the endpoint
 * returns key=null — the panel then stays on polling notifications instead
 * of authenticating with a guessable default.
 */
export async function GET() {
  const session = await requireAdmin();
  if (!session) return fail("دسترسی غیرمجاز", 401);

  const env = await getCloudflareEnv().catch(() => null);
  const key = env?.ADMIN_NOTIFY_KEY ?? process.env.ADMIN_NOTIFY_KEY ?? "";
  return ok({ key: key.length >= 16 ? key : null });
}

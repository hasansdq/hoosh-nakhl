import { ok, fail, requireAdmin } from "@/lib/api";

/**
 * GET /api/admin/notify-key
 * Returns the shared-secret key the admin panel uses to join the
 * real-time notification room (socket.io "admin-join" handshake).
 * The key only grants LISTENING access; emitting requires the
 * server-side x-notify-key header which never leaves the backend.
 */
export async function GET() {
  const session = await requireAdmin();
  if (!session) return fail("دسترسی غیرمجاز", 401);

  return ok({ key: process.env.ADMIN_NOTIFY_KEY ?? "nakhl-notify-2024" });
}

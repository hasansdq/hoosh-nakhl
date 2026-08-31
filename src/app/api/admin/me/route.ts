import { ok, fail, requireAdmin } from "@/lib/api";

export async function GET() {
  const session = await requireAdmin();
  if (!session) return fail("دسترسی غیرمجاز", 401);
  return ok({
    admin: {
      username: session.admin.username,
      displayName: session.admin.displayName,
      lastLoginAt: session.admin.lastLoginAt?.toISOString() ?? null,
    },
  });
}

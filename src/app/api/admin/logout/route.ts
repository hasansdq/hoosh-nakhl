import { ok } from "@/lib/api";
import { destroyAdminSession, getAdminSession } from "@/lib/auth";
import { logAudit } from "@/lib/api";

export async function POST() {
  const session = await getAdminSession();
  if (session) await logAudit(session.admin.username, "ADMIN_LOGOUT", {});
  await destroyAdminSession();
  return ok({ message: "خارج شدید" });
}

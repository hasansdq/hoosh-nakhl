import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, logAudit } from "@/lib/api";
import { verifyPassword, createAdminSession, rateLimit, getClientIp } from "@/lib/auth";
import { adminLoginSchema } from "@/lib/validators";

const MAX_FAILED = 5;
const LOCK_MINUTES = 10;

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`admin-login:${ip}`, 10, 10 * 60 * 1000);
    if (!rl.ok) return fail(`تلاش‌های زیاد. ${rl.retryAfter} ثانیه صبر کنید`, 429);

    const body = await req.json().catch(() => ({}));
    const parsed = adminLoginSchema.safeParse(body);
    if (!parsed.success) return fail("نام کاربری یا رمز عبور نامعتبر است", 401);

    const admin = await db.adminUser.findUnique({ where: { username: parsed.data.username } });
    if (!admin) {
      await logAudit("unknown", "ADMIN_LOGIN_FAILED", { detail: { username: parsed.data.username }, ip });
      return fail("نام کاربری یا رمز عبور نامعتبر است", 401);
    }

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      const mins = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60000);
      return fail(`حساب به دلیل تلاش‌های ناموفق موقتاً قفل است (${mins} دقیقه)`, 423);
    }

    if (!verifyPassword(parsed.data.password, admin.passwordHash)) {
      const failed = admin.failedAttempts + 1;
      await db.adminUser.update({
        where: { id: admin.id },
        data: {
          failedAttempts: failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : null,
        },
      });
      await logAudit(admin.username, "ADMIN_LOGIN_FAILED", { ip });
      return fail(
        failed >= MAX_FAILED
          ? `تلاش‌های ناموفق زیاد؛ حساب برای ${LOCK_MINUTES} دقیقه قفل شد`
          : `نام کاربری یا رمز عبور نامعتبر است (${MAX_FAILED - failed} تلاش باقی مانده)`,
        401
      );
    }

    await db.adminUser.update({
      where: { id: admin.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await createAdminSession(admin.id, ip, req.headers.get("user-agent") ?? undefined);
    await logAudit(admin.username, "ADMIN_LOGIN_SUCCESS", { ip });

    return ok({ admin: { username: admin.username, displayName: admin.displayName } });
  } catch (e) {
    console.error("admin login error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

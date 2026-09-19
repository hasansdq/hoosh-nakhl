import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { verifyHash, createUserSession, rateLimit, getClientIp } from "@/lib/auth";
import { normalizePhone } from "@/lib/fa";
import { z } from "zod";

const bodySchema = z.object({
  phone: z.string().min(5).max(30),
  code: z.string().regex(/^\d{4,8}$/, "کد تأیید نامعتبر است"),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const body = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");

    const phone = normalizePhone(parsed.data.phone);
    if (!phone) return fail("شماره موبایل نامعتبر است");

    const rl = rateLimit(`verify:${phone}`, 6, 10 * 60 * 1000);
    if (!rl.ok) {
      return fail(`تلاش‌های ناموفق زیاد بود. ${Math.ceil(rl.retryAfter / 60)} دقیقه دیگر تلاش کنید`, 429);
    }

    const otp = await db.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) return fail("کد منقضی شده است. دوباره درخواست کد بدهید", 410);
    if (otp.attempts >= 5) return fail("تعداد تلاش‌ها بیش از حد مجاز بود. کد جدید بگیرید", 429);

    if (!verifyHash(parsed.data.code, otp.codeHash)) {
      await db.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      const left = 4 - otp.attempts;
      return fail(left > 0 ? `کد نادرست است (${left} تلاش باقی مانده)` : "تعداد تلاش‌ها تمام شد، کد جدید بگیرید");
    }

    await db.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    const user = await db.user.findUnique({ where: { phone } });

    if (user) {
      if (user.status === "BLOCKED") {
        return fail("حساب کاربری شما مسدود شده است. با پشتیبانی تماس بگیرید", 403);
      }
      await createUserSession(user.id, ip, req.headers.get("user-agent") ?? undefined);
      await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      return ok({ registered: true });
    }

    // Not registered → issue one-time registration token (valid 10 min)
    const regToken = `${phone}:${otp.codeHash}:${Date.now()}`;
    return ok({
      registered: false,
      otpToken: regToken,
      hint: "اطلاعات هویتی خود را تکمیل کنید",
    });
  } catch (e) {
    console.error("verify-otp error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

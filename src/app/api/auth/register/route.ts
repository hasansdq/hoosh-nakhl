import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, publicUser, logAudit } from "@/lib/api";
import { createUserSession, rateLimit, getClientIp } from "@/lib/auth";
import { normalizePhone, parseJalaliDate, isValidNationalId } from "@/lib/fa";
import { registerSchema } from "@/lib/validators";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`register:${ip}`, 10, 30 * 60 * 1000);
    if (!rl.ok) return fail("درخواست‌های بیش از حد", 429);

    const body = await req.json().catch(() => ({}));
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");
    const data = parsed.data;

    // Validate otpToken (phone:hash:timestamp from verify step)
    const parts = data.otpToken.split(":");
    if (parts.length !== 3) return fail("توکن ثبت‌نام نامعتبر است", 401);
    const [tokenPhone, tokenHash, ts] = parts;
    const phone = normalizePhone(tokenPhone);
    if (!phone || tokenPhone !== phone) return fail("توکن ثبت‌نام نامعتبر است", 401);
    if (Date.now() - Number(ts) > 10 * 60 * 1000) return fail("مدت تکمیل ثبت‌نام گذشته است. دوباره وارد شوید", 401);

    // Verify the hash matches a recently consumed OTP for this phone
    const otp = await db.otpCode.findFirst({
      where: { phone, codeHash: tokenHash, consumedAt: { not: null } },
      orderBy: { consumedAt: "desc" },
    });
    if (!otp || otp.consumedAt! < new Date(Date.now() - 15 * 60 * 1000)) {
      return fail("توکن ثبت‌نام معتبر نیست. از ابتدا اقدام کنید", 401);
    }

    const existing = await db.user.findUnique({ where: { phone } });
    if (existing) return fail("این شماره قبلاً ثبت‌نام کرده است. وارد شوید", 409);

    // National ID validation
    if (data.nationalId && !isValidNationalId(data.nationalId)) {
      return fail("کد ملی نامعتبر است");
    }

    const birthDate = data.birthDate ? parseJalaliDate(data.birthDate) : null;
    if (data.birthDate && !birthDate) {
      return fail("تاریخ تولد را به شکل ۱۴۰۰/۰۵/۱۲ وارد کنید");
    }

    const user = await db.user.create({
      data: {
        phone,
        firstName: data.firstName,
        lastName: data.lastName,
        nationalId: data.nationalId || null,
        email: data.email || null,
        gender: data.gender || null,
        birthDate,
        lastLoginAt: new Date(),
      },
    });

    await createUserSession(user.id, ip, req.headers.get("user-agent") ?? undefined);
    await logAudit(user.id, "USER_REGISTERED", { ip, entity: "user", entityId: user.id });

    return ok({ user: publicUser(user) });
  } catch (e) {
    console.error("register error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

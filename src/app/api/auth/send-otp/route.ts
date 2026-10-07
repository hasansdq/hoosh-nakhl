import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, logAudit } from "@/lib/api";
import { getSettings, type SMSSettings } from "@/lib/settings";
import { sendOtpSms } from "@/lib/sms";
import { generateOtpCode, sha256, rateLimit, getClientIp } from "@/lib/auth";
import { normalizePhone } from "@/lib/fa";
import { z } from "zod";

const bodySchema = z.object({ phone: z.string().min(5).max(30) });

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`otp:ip:${ip}`, 8, 10 * 60 * 1000); // 8 per 10min per IP
    if (!rl.ok) {
      return fail(`درخواست‌های بیش از حد. لطفاً ${rl.retryAfter} ثانیه دیگر تلاش کنید`, 429);
    }

    const body = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return fail("شماره موبایل معتبر نیست");

    const phone = normalizePhone(parsed.data.phone);
    if (!phone) return fail("شماره موبایل را به صورت صحیح وارد کنید (مثال: ۰۹۱۲۳۴۵۶۷۸۹)");

    const rlPhone = rateLimit(`otp:phone:${phone}`, 3, 5 * 60 * 1000); // 3 per 5min per phone
    if (!rlPhone.ok) {
      return fail(`برای این شماره کد ارسال شده است. ${Math.ceil(rlPhone.retryAfter / 60)} دقیقه دیگر تلاش کنید`, 429);
    }

    const settings = await getSettings<SMSSettings>("sms");
    const user = await db.user.findUnique({ where: { phone } });
    const purpose = user ? "LOGIN" : "REGISTER";

    // invalidate previous active codes
    await db.otpCode.updateMany({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    const code = generateOtpCode(settings.otpLength);
    const ttl = Math.max(1, Math.min(15, settings.otpTtlMinutes));

    await db.otpCode.create({
      data: {
        phone,
        codeHash: sha256(code),
        purpose,
        expiresAt: new Date(Date.now() + ttl * 60 * 1000),
      },
    });

    const smsResult = await sendOtpSms(settings, phone, code);

    if (!smsResult.success) {
      await logAudit("system", "OTP_SEND_FAILED", { detail: { phone, provider: smsResult.provider, error: smsResult.error }, ip });
      return fail(`خطا در ارسال پیامک: ${smsResult.error ?? "نامشخص"}`, 502);
    }

    await logAudit("system", "OTP_SENT", { detail: { phone: `***${phone.slice(-4)}`, provider: smsResult.provider }, ip });

    // PRODUCTION SAFETY: the OTP code is only ever exposed in the API response
    // while running in development (sandbox QA flow). In production the code is
    // only delivered via SMS — unless explicitly re-enabled for a staged test
    // with NAKHL_EXPOSE_DEV_CODE=1.
    const exposeDevCode =
      process.env.NODE_ENV !== "production" || process.env.NAKHL_EXPOSE_DEV_CODE === "1";

    return ok({
      purpose,
      ttlMinutes: ttl,
      devCode: smsResult.devMode && exposeDevCode ? code : undefined, // only in dev mode
    });
  } catch (e) {
    console.error("send-otp error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

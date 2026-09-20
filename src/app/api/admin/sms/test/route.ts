import { NextRequest } from "next/server";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getSettings, type SMSSettings } from "@/lib/settings";
import { testSmsProvider } from "@/lib/sms";
import { getClientIp } from "@/lib/auth";

/**
 * POST /api/admin/sms/test
 * تست اتصال پنل پیامکی از مدیریت — «بدون ارسال پیامک واقعی»:
 *  - ملی‌پیامک (کلید API): استعلام اعتبار از کنسول جدید console.melipayamak.com
 *  - ملی‌پیامک (کاربری/رمز): متد GetCredit پنل قدیمی rest.payamak-panel.com
 *
 * body (اختیاری): { values } — مقادیر فرم فعلی پنل؛ مقادیر ماسک‌شده (•) نادیده
 * گرفته می‌شوند و از تنظیمات ذخیره‌شده تکمیل می‌شوند (تست قبل از ذخیره ممکن است).
 * پاسخ: { success, message?, error? }
 */
const TESTABLE_KEYS = [
  "provider",
  "melipayamakAuthType",
  "melipayamakApiKey",
  "melipayamakUsername",
  "melipayamakPassword",
  "melipayamakFrom",
  "melipayamakPatternCode",
  "smsirApiKey",
  "smsirFrom",
  "smsirTemplateId",
] as const;

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const saved = await getSettings<SMSSettings>("sms");

    // ادغام مقادیر فرم (بدون ذخیره) روی تنظیمات موجود — مقادیر ماسک‌شده را نگه می‌داریم
    const body = (await req.json().catch(() => ({}))) as { values?: Record<string, unknown> };
    const settings: SMSSettings = { ...saved };
    if (body.values && typeof body.values === "object") {
      for (const key of TESTABLE_KEYS) {
        const v = body.values[key];
        if (typeof v === "string") {
          if (v.includes("•")) continue; // ماسک — مقدار ذخیره‌شده معتبر است
          settings[key] = v as never;
        }
      }
    }

    if (settings.provider === "none") {
      return ok({
        message: "هیچ سرویس‌دهندهٔ پیامکی انتخاب نشده — ابتدا پنل پیامکی را انتخاب و ذخیره کنید",
      });
    }

    // مقادیر خالی؟ قبل از فراخوانی شبکه هشدار بده
    if (settings.provider === "melipayamak") {
      if (settings.melipayamakAuthType === "apikey" && !(settings.melipayamakApiKey ?? "").trim()) {
        return fail("کلید کنسول ملی‌پیامک وارد نشده است — ابتدا کلید را در فرم وارد کنید");
      }
      if (
        settings.melipayamakAuthType === "password" &&
        (!settings.melipayamakUsername || !settings.melipayamakPassword)
      ) {
        return fail("نام کاربری/رمز ملی‌پیامک کامل نیست — ابتدا مقادیر را در فرم وارد کنید");
      }
    }
    if (settings.provider === "smsir" && !settings.smsirApiKey) {
      return fail("کلید API پیامکستان وارد نشده است — ابتدا کلید را در فرم وارد کنید");
    }

    const result = await testSmsProvider(settings);

    await logAudit(session.admin.username, "SMS_TEST", {
      entity: "settings",
      entityId: "sms",
      detail: {
        provider: result.provider,
        success: result.success,
        error: result.error ?? null,
      },
      ip: getClientIp(req),
    });

    if (result.success) {
      return ok({
        message:
          result.message ??
          (result.devMode
            ? "حالت توسعه فعال است — کد تأیید در صفحه ورود نمایش داده می‌شود"
            : "اتصال برقرار است ✅"),
        credit: result.credit,
      });
    }

    return fail(result.error ?? "خطا در تست اتصال", 502, { provider: result.provider });
  } catch (e) {
    console.error("sms test error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

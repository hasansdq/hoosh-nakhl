import { NextRequest } from "next/server";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getSettings, type AISettings } from "@/lib/settings";
import { testConnection, AI_PROVIDERS } from "@/lib/ai";
import { getClientIp } from "@/lib/auth";

/**
 * POST /api/admin/ai/test
 * تست اتصال موتور هوش مصنوعی از تب تنظیمات مدیریت:
 *  ۱) فهرست مدل‌ها از پایانهٔ ارائه‌دهنده (بدون هزینه)
 *  ۲) یک تکمیل کوتاه آزمایشی (maxTokens=10)
 *
 * body (اختیاری): { provider?, apiKey?, baseUrl?, model? } — مقادیر فرم فعلی
 * پنل؛ مقادیر ماسک‌شده (•) نادیده گرفته می‌شوند و از تنظیمات ذخیره‌شده
 * تکمیل می‌شوند (تست قبل از ذخیره ممکن است — همان قرارداد /api/admin/sms/test).
 *
 * پاسخ: { success, connected, message, models: [{id, name?}] }
 */
const TESTABLE_KEYS = ["provider", "apiKey", "baseUrl", "model"] as const;

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const saved = await getSettings<AISettings>("ai");

    // ادغام مقادیر فرم (بدون ذخیره) روی تنظیمات موجود — مقادیر ماسک‌شده معتبرند
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const settings: AISettings = { ...saved };
    for (const key of TESTABLE_KEYS) {
      const v = body[key];
      if (typeof v === "string") {
        if (v.includes("•")) continue; // ماسک — مقدار ذخیره‌شده معتبر است
        if (v.trim() === "" && key !== "baseUrl") continue; // خالی → مقدار ذخیره‌شده
        settings[key] = v as never;
      }
    }

    if (!(settings.provider in AI_PROVIDERS)) {
      return fail("ارائه‌دهندهٔ هوش مصنوعی معتبر نیست (openai / openrouter / zai)");
    }
    if (settings.provider !== "zai" && !(settings.apiKey ?? "").trim()) {
      return fail("کلید API وارد نشده است — ابتدا کلید را در فرم وارد کنید");
    }

    const result = await testConnection(settings);

    await logAudit(session.admin.username, "AI_TEST", {
      entity: "settings",
      entityId: "ai",
      detail: {
        provider: settings.provider,
        connected: result.success,
        error: result.success ? null : (result.message ?? null),
      },
      ip: getClientIp(req),
    });

    // HTTP-level success even when the connection itself fails — the panel
    // renders `connected:false` + the provider message inline.
    return ok({
      connected: result.success,
      message: result.message,
      models: result.models,
    });
  } catch (e) {
    console.error("ai test error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

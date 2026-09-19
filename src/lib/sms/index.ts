import "server-only";
import type { SMSSettings } from "@/lib/settings";

export interface SmsResult {
  success: boolean;
  error?: string;
  provider: string;
  devMode?: boolean;
  /** human-readable outcome (used by admin connection test) */
  message?: string;
  /** remaining panel credit (when the provider exposes it) */
  credit?: number;
}

function toLocalPhone(phone: string): string {
  // 989xxxxxxxxx -> 09xxxxxxxxx
  const p = phone.replace(/\D/g, "");
  return p.startsWith("98") ? `0${p.slice(2)}` : p;
}

// ============ Melipayamak ============

/**
 * ملی‌پیامک — دو نسل وب‌سرویس:
 *
 * ۱) کنسول جدید (Token/API-Key) — مستندات رسمی: console.melipayamak.com
 *    ارسال ساده:  POST https://console.melipayamak.com/api/send/simple/{token}
 *      body: { from, to, text }          → from الزامی است
 *    ارسال پترن (خط خدماتی اشتراکی):
 *                 POST https://console.melipayamak.com/api/send/shared/{token}
 *      body: { to, bodyId, args: ["کد", ...] }
 *      → پترن باید از قبل در پنل ملی‌پیامک ساخته و تأیید شده باشد؛
 *        bodyId = کد پترن، args = مقادیر متغیرهای پترن به‌ترتیب (%0، %1، ...)
 *        (متد sendShared کتابخانهٔ رسمی node-melipayamak — همین قرارداد)
 *    اعتبار:      GET  https://console.melipayamak.com/api/receive/credit/{token}
 *
 * ۲) پنل قدیمی (username/password) — rest.payamak-panel.com
 *    ارسال ساده:  POST /api/SendSMS/SendSMS  { username, password, to, from, text, isFlash }
 *    ارسال پترن:  POST /api/SendSMS/BaseServiceNumber  (form-urlencoded)
 *      username, password, to, bodyId (کد پترن), text (متغیرها با «؛» جدا)
 *      → مستندات رسمی SendByBaseNumber2: ReturnValue = recId (بیش از ۱۰ رقم ⇒ موفق)
 *        یا کد خطا (۰ = اعتبارنامه اشتباه، ‎-4 = کد پترن نامعتبر/تأییدنشده، ...)
 *    اعتبار:      POST /api/SendSMS/GetCredit { username, password }
 */

const MELIPAYAMAK_CONSOLE_BASE = "https://console.melipayamak.com/api";
const MELIPAYAMAK_LEGACY_BASE = "https://rest.payamak-panel.com/api/SendSMS";

interface ConsoleResponse {
  recId?: number | string;
  recIds?: Array<number | string>;
  status?: string;
  amount?: number | string;
  count?: number;
  price?: number;
}

interface LegacyResponse {
  Value?: string;
  RetStatus?: number;
  StrRetStatus?: string;
}

/** Parse ASP.NET ProblemDetails validation errors into a readable Persian message */
function parseValidationErrors(body: unknown): string | null {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.status === "number" && b.status >= 400 && b.errors && typeof b.errors === "object") {
      const errs = b.errors as Record<string, unknown>;
      for (const v of Object.values(errs)) {
        if (Array.isArray(v) && typeof v[0] === "string" && v[0]) {
          // e.g. "JSON deserialization ... missing required properties including: 'from'."
          const missing = v[0].match(/'([^']+)'/);
          if (missing) return `فیلد «${missing[1]}» برای ملی‌پیامک الزامی است`;
          return v[0];
        }
      }
      return "داده ارسالی به ملی‌پیامک نامعتبر است";
    }
  }
  return null;
}

function consoleSuccess(body: ConsoleResponse): boolean {
  // موفق: recId معتبر موجود باشد و status خطا نداشته باشد
  const recId = Number(body.recId ?? 0);
  const hasErrorStatus = typeof body.status === "string" && body.status.trim() !== "";
  return recId > 0 && !hasErrorStatus;
}

async function sendMelipayamakConsole(
  settings: SMSSettings,
  to: string,
  text: string
): Promise<SmsResult> {
  const apiKey = (settings.melipayamakApiKey ?? "").trim();
  const from = (settings.melipayamakFrom ?? "").trim();
  const localPhone = toLocalPhone(to);

  if (!apiKey) {
    return { success: false, provider: "melipayamak", error: "کلید کنسول ملی‌پیامک تنظیم نشده است" };
  }
  if (!from) {
    return {
      success: false,
      provider: "melipayamak",
      error: "شماره فرستنده (From) برای ارسال با کلید API الزامی است — آن را در تنظیمات وارد کنید",
    };
  }

  try {
    const res = await fetch(`${MELIPAYAMAK_CONSOLE_BASE}/send/simple/${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({ from, to: localPhone, text }),
      signal: AbortSignal.timeout(20000),
    });

    const raw = await res.text();
    let body: ConsoleResponse = {};
    try {
      body = JSON.parse(raw) as ConsoleResponse;
    } catch {
      // HTML/console page — unexpected payload
      return {
        success: false,
        provider: "melipayamak",
        error: `پاسخ نامعتبر از کنسول ملی‌پیامک (کد ${res.status})`,
      };
    }

    if (consoleSuccess(body)) {
      return { success: true, provider: "melipayamak" };
    }

    const validation = parseValidationErrors(body);
    if (validation) {
      return { success: false, provider: "melipayamak", error: validation };
    }

    return {
      success: false,
      provider: "melipayamak",
      error: body.status?.trim() || `خطای پنل ملی‌پیامک (کد ${res.status})`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطای نامشخص";
    const timedOut = msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("abort");
    return {
      success: false,
      provider: "melipayamak",
      error: timedOut
        ? "پاسخ ملی‌پیامک بیش از حد طول کشید — اتصال سرور به console.melipayamak.com را بررسی کنید"
        : `خطا در ارتباط با ملی‌پیامک: ${msg}`,
    };
  }
}

async function sendMelipayamakLegacy(
  settings: SMSSettings,
  to: string,
  text: string
): Promise<SmsResult> {
  const localPhone = toLocalPhone(to);
  if (!settings.melipayamakUsername || !settings.melipayamakPassword) {
    return { success: false, provider: "melipayamak", error: "نام کاربری/رمز ملی‌پیامک کامل نیست" };
  }
  if (!settings.melipayamakFrom) {
    return {
      success: false,
      provider: "melipayamak",
      error: "شماره فرستنده (From) الزامی است — آن را در تنظیمات وارد کنید",
    };
  }

  try {
    const res = await fetch(`${MELIPAYAMAK_LEGACY_BASE}/SendSMS`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: settings.melipayamakUsername,
        password: settings.melipayamakPassword,
        to: localPhone,
        from: settings.melipayamakFrom,
        text,
        isFlash: false,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = (await res.json().catch(() => ({}))) as LegacyResponse;
    // RetStatus === 1 ⇒ ارسال موفق
    if (body.RetStatus === 1) {
      return { success: true, provider: "melipayamak" };
    }
    return {
      success: false,
      provider: "melipayamak",
      error: body.StrRetStatus || `خطای پنل ملی‌پیامک (کد ${body.RetStatus ?? res.status})`,
    };
  } catch (e) {
    return {
      success: false,
      provider: "melipayamak",
      error: e instanceof Error ? `خطا در ارتباط با ملی‌پیامک: ${e.message}` : "خطای نامشخص ملی‌پیامک",
    };
  }
}

// ============ Melipayamak (ارسال با پترن خدماتی) ============

/**
 * اعتبارسنجی مشترک کد پترن — عدد صحیح مثبت است که پنل ملی‌پیامک بعد از
 * تأیید پترن صادر می‌کند (مثلاً 254).
 */
function validatePatternCode(settings: SMSSettings): { code: string; error?: string } {
  const code = (settings.melipayamakPatternCode ?? "").trim();
  if (!code) {
    return { code, error: "کد پترن ملی‌پیامک تنظیم نشده است" };
  }
  if (!/^\d+$/.test(code) || Number(code) <= 0) {
    return { code, error: "کد پترن ملی‌پیامک باید عدد باشد (کد تأییدشدهٔ پترن در پنل ملی‌پیامک)" };
  }
  return { code };
}

/**
 * ارسال با پترن از «خط خدماتی اشتراکی» — کنسول جدید (API-Key):
 * POST /api/send/shared/{token}  body: { to, bodyId, args }
 * طبق مستندات رسمی ملی‌پیامک (متد SendShared) — تحویل حتی به لیست سیاه مخابرات.
 */
async function sendMelipayamakConsolePattern(
  settings: SMSSettings,
  to: string,
  args: string[]
): Promise<SmsResult> {
  const apiKey = (settings.melipayamakApiKey ?? "").trim();
  if (!apiKey) {
    return { success: false, provider: "melipayamak", error: "کلید کنسول ملی‌پیامک تنظیم نشده است" };
  }
  const { code: patternCode, error } = validatePatternCode(settings);
  if (error) {
    return { success: false, provider: "melipayamak", error };
  }

  try {
    const res = await fetch(`${MELIPAYAMAK_CONSOLE_BASE}/send/shared/${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({
        to: toLocalPhone(to),
        bodyId: Number(patternCode),
        args,
      }),
      signal: AbortSignal.timeout(20000),
    });

    const raw = await res.text();
    let body: ConsoleResponse = {};
    try {
      body = JSON.parse(raw) as ConsoleResponse;
    } catch {
      return {
        success: false,
        provider: "melipayamak",
        error: `پاسخ نامعتبر از کنسول ملی‌پیامک (کد ${res.status})`,
      };
    }

    if (consoleSuccess(body)) {
      return { success: true, provider: "melipayamak", message: "ارسال با پترن خدماتی انجام شد" };
    }

    const validation = parseValidationErrors(body);
    if (validation) {
      return { success: false, provider: "melipayamak", error: validation };
    }

    return {
      success: false,
      provider: "melipayamak",
      error: body.status?.trim() || `خطای پنل ملی‌پیامک (کد ${res.status})`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطای نامشخص";
    const timedOut = msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("abort");
    return {
      success: false,
      provider: "melipayamak",
      error: timedOut
        ? "پاسخ ملی‌پیامک بیش از حد طول کشید — اتصال سرور به console.melipayamak.com را بررسی کنید"
        : `خطا در ارتباط با ملی‌پیامک: ${msg}`,
    };
  }
}

/** ترجمهٔ کدهای خطای متد BaseServiceNumber پنل قدیمی (مستندات رسمی ملی‌پیامک) */
function legacyPatternErrorMessage(value: number): string | null {
  switch (value) {
    case 0: return "نام کاربری یا رمز عبور ملی‌پیامک صحیح نیست";
    case 2: return "اعتبار پنل ملی‌پیامک کافی نیست";
    case 6: return "سامانهٔ ملی‌پیامک در حال به‌روزرسانی است — بعداً تلاش کنید";
    case 7: return "متن ارسالی حاوی کلمهٔ فیلترشده است";
    case 10: return "کاربر پنل ملی‌پیامک فعال نیست";
    case 11: return "پیامک ارسال نشد — با پشتیبانی ملی‌پیامک تماس بگیرید";
    case 12: return "مدارک کاربر پنل ملی‌پیامک کامل نیست";
    case 16: return "شمارهٔ گیرنده یافت نشد";
    case 17: return "متن پیامک خالی است";
    case 18: return "شمارهٔ گیرنده نامعتبر است";
    case 19: return "از محدودیت ساعتی ارسال ملی‌پیامک فراتر رفته‌اید";
    case 35: return "شمارهٔ گیرنده در لیست سیاه مخابرات است";
    case -1: return "دسترسی وب‌سرویس خدماتی برای پنل شما فعال نیست — با پشتیبانی ملی‌پیامک تماس بگیرید";
    case -2: return "در هر ارسال پترن فقط یک شمارهٔ گیرنده مجاز است";
    case -3: return "خط خدماتی در پنل شما تعریف نشده است — با پشتیبانی ملی‌پیامک تماس بگیرید";
    case -4: return "کد پترن صحیح نیست یا توسط مدیر ملی‌پیامک تأیید نشده است";
    case -5: return "متغیرهای ارسالی با پترن همخوانی ندارد — پترن باید دقیقاً یک متغیر (%0) برای کد تأیید داشته باشد";
    case -6: return "خطای داخلی ملی‌پیامک — با پشتیبانی تماس بگیرید";
    case -7: return "خطای شمارهٔ فرستنده — با پشتیبانی ملی‌پیامک تماس بگیرید";
    case -10: return "متغیرهای ارسالی نباید حاوی لینک باشند";
    case -108: return "IP شما به دلیل تلاش‌های ناموفق مسدود شده است";
    case -109: return "ابتدا IP مجاز را در تنظیمات وب‌سرویس پنل ملی‌پیامک ثبت کنید";
    case -110: return "به‌جای رمز عبور باید از API Key استفاده کنید (تنظیمات پنل ملی‌پیامک)";
    case -111: return "IP درخواست‌کننده معتبر نیست — IP سرور را در پنل ملی‌پیامک ثبت کنید";
    default: return null;
  }
}

/**
 * ارسال با پترن از «خط خدماتی اشتراکی» — پنل قدیمی (username/password):
 * POST /api/SendSMS/BaseServiceNumber (form-urlencoded)
 *   username, password, to, bodyId, text = متغیرها با «؛» جدا
 * پاسخ: { Value: recId(>10 رقم ⇒ موفق) | کد خطا, RetStatus, StrRetStatus }
 */
async function sendMelipayamakLegacyPattern(
  settings: SMSSettings,
  to: string,
  args: string[]
): Promise<SmsResult> {
  if (!settings.melipayamakUsername || !settings.melipayamakPassword) {
    return { success: false, provider: "melipayamak", error: "نام کاربری/رمز ملی‌پیامک کامل نیست" };
  }
  const { code: patternCode, error } = validatePatternCode(settings);
  if (error) {
    return { success: false, provider: "melipayamak", error };
  }

  try {
    const res = await fetch(`${MELIPAYAMAK_LEGACY_BASE}/BaseServiceNumber`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: new URLSearchParams({
        username: settings.melipayamakUsername,
        password: settings.melipayamakPassword,
        to: toLocalPhone(to),
        bodyId: patternCode,
        text: args.join(";"),
      }).toString(),
      signal: AbortSignal.timeout(20000),
    });
    const body = (await res.json().catch(() => ({}))) as LegacyResponse;

    // طبق مستندات رسمی: ReturnValue = recId عددی بلند ⇒ موفق؛ مقدارهای کوچک = کد خطا
    const value = String(body.Value ?? "").trim();
    if (/^\d{10,}$/.test(value)) {
      return { success: true, provider: "melipayamak", message: "ارسال با پترن خدماتی انجام شد" };
    }

    const code = Number(value);
    const mapped = Number.isFinite(code) ? legacyPatternErrorMessage(code) : null;
    const fallbackCode = value || String(body.RetStatus ?? res.status);
    return {
      success: false,
      provider: "melipayamak",
      error:
        mapped ??
        (body.StrRetStatus === "UserNameAndPasswordFailed"
          ? "نام کاربری یا رمز عبور ملی‌پیامک اشتباه است"
          : body.StrRetStatus || `خطای پنل ملی‌پیامک (کد ${fallbackCode})`),
    };
  } catch (e) {
    return {
      success: false,
      provider: "melipayamak",
      error: e instanceof Error ? `خطا در ارتباط با ملی‌پیامک: ${e.message}` : "خطای نامشخص ملی‌پیامک",
    };
  }
}

async function sendMelipayamak(
  settings: SMSSettings,
  to: string,
  text: string
): Promise<SmsResult> {
  if (settings.melipayamakAuthType === "apikey") {
    return sendMelipayamakConsole(settings, to, text);
  }
  return sendMelipayamakLegacy(settings, to, text);
}

/**
 * تست اتصال ملی‌پیامک «بدون ارسال پیامک»:
 * - کنسول جدید: GET /receive/credit/{token} → کلید معتبر باشد amount برمی‌گردد
 * - پنل قدیمی:  POST SendSMS/GetCredit → RetStatus===1 و Value=اعتبار
 */
async function testMelipayamakConnection(settings: SMSSettings): Promise<SmsResult> {
  // ---------- کنسول جدید (API-Key) ----------
  if (settings.melipayamakAuthType === "apikey") {
    const apiKey = (settings.melipayamakApiKey ?? "").trim();
    if (!apiKey) {
      return { success: false, provider: "melipayamak", error: "کلید کنسول ملی‌پیامک تنظیم نشده است" };
    }
    try {
      const res = await fetch(
        `${MELIPAYAMAK_CONSOLE_BASE}/receive/credit/${encodeURIComponent(apiKey)}`,
        {
          method: "GET",
          headers: { "Cache-Control": "no-cache" },
          // console APIs require a content-length on some proxies — GET with empty body
          signal: AbortSignal.timeout(20000),
        }
      );
      const raw = await res.text();
      let body: ConsoleResponse = {};
      try {
        body = JSON.parse(raw) as ConsoleResponse;
      } catch {
        return {
          success: false,
          provider: "melipayamak",
          error: `پاسخ نامعتبر از کنسول ملی‌پیامک (کد ${res.status})`,
        };
      }

      const validation = parseValidationErrors(body);
      if (validation) {
        return { success: false, provider: "melipayamak", error: validation };
      }

      const hasErrorStatus = typeof body.status === "string" && body.status.trim() !== "";
      const amountKnown = body.amount !== undefined && body.amount !== null;

      // کلید معتبر: HTTP 200 بدون status خطا (amount ممکن است در پاسخ باشد)
      if (res.ok && !hasErrorStatus) {
        const credit = Number(body.amount);
        const creditStr = amountKnown && Number.isFinite(credit) ? credit.toLocaleString("fa-IR") : null;
        const patternCode = (settings.melipayamakPatternCode ?? "").trim();
        const mode = patternCode
          ? ` — ارسال کد تأیید با پترن خدماتی (کد ${patternCode})`
          : " — ارسال ساده از خط اختصاصی";
        return {
          success: true,
          provider: "melipayamak",
          credit: amountKnown && Number.isFinite(credit) ? credit : undefined,
          message: `اتصال به کنسول ملی‌پیامک برقرار است ✅${creditStr ? ` — اعتبار پنل: ${creditStr}` : ""}${mode}`,
        };
      }

      return {
        success: false,
        provider: "melipayamak",
        error: (body.status ?? "").trim() || `کلید کنسول معتبر نیست (کد ${res.status})`,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطای نامشخص";
      return {
        success: false,
        provider: "melipayamak",
        error: `خطا در ارتباط با کنسول ملی‌پیامک: ${msg}`,
      };
    }
  }

  // ---------- پنل قدیمی (username/password) ----------
  if (!settings.melipayamakUsername || !settings.melipayamakPassword) {
    return { success: false, provider: "melipayamak", error: "نام کاربری/رمز ملی‌پیامک کامل نیست" };
  }
  try {
    const res = await fetch(`${MELIPAYAMAK_LEGACY_BASE}/GetCredit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: settings.melipayamakUsername,
        password: settings.melipayamakPassword,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = (await res.json().catch(() => ({}))) as LegacyResponse;
    if (body.RetStatus === 1) {
      const credit = Number(body.Value);
      return {
        success: true,
        provider: "melipayamak",
        credit: Number.isFinite(credit) ? credit : undefined,
        message: `اتصال به پنل ملی‌پیامک برقرار است ✅${Number.isFinite(credit) ? ` — اعتبار پنل: ${credit.toLocaleString("fa-IR")}` : ""}`,
      };
    }
    return {
      success: false,
      provider: "melipayamak",
      error:
        body.StrRetStatus === "UserNameAndPasswordFailed"
          ? "نام کاربری یا رمز عبور ملی‌پیامک اشتباه است"
          : body.StrRetStatus || `خطای پنل ملی‌پیامک (کد ${body.RetStatus ?? res.status})`,
    };
  } catch (e) {
    return {
      success: false,
      provider: "melipayamak",
      error: e instanceof Error ? `خطا در ارتباط با ملی‌پیامک: ${e.message}` : "خطای نامشخص ملی‌پیامک",
    };
  }
}

// ============ SMS.IR ============

/**
 * SMS.IR
 * - OTP verify: POST https://api.sms.ir/v1/send/verify  (templateId + parameters)
 * - Rapid:      POST https://api.sms.ir/v1/send/rapid   (simple text)
 */
async function sendSmsIr(
  settings: SMSSettings,
  to: string,
  text: string,
  code: string
): Promise<SmsResult> {
  const localPhone = toLocalPhone(to);
  try {
    if (!settings.smsirApiKey) {
      return { success: false, provider: "smsir", error: "کلید API پیامکستان تنظیم نشده است" };
    }
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": settings.smsirApiKey,
      "Accept": "application/json",
    };

    // If templateId configured -> use verify endpoint (best for OTP)
    if (settings.smsirTemplateId) {
      const res = await fetch("https://api.sms.ir/v1/send/verify", {
        method: "POST",
        headers,
        body: JSON.stringify({
          mobile: localPhone,
          templateId: Number(settings.smsirTemplateId),
          parameters: [
            { name: settings.smsirOtpParam || "CODE", value: code },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: number;
        message?: string;
      };
      if (res.ok && body.status === 1) {
        return { success: true, provider: "smsir" };
      }
      return {
        success: false,
        provider: "smsir",
        error: body.message || `خطای SMS.IR (کد ${body.status ?? res.status})`,
      };
    }

    // Otherwise rapid send
    const res = await fetch("https://api.sms.ir/v1/send/rapid", {
      method: "POST",
      headers,
      body: JSON.stringify({
        lineNumber: settings.smsirFrom || undefined,
        mobile: localPhone,
        message: text,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      status?: number;
      message?: string;
    };
    if (res.ok && body.status === 1) {
      return { success: true, provider: "smsir" };
    }
    return {
      success: false,
      provider: "smsir",
      error: body.message || `خطای SMS.IR (کد ${body.status ?? res.status})`,
    };
  } catch (e) {
    return {
      success: false,
      provider: "smsir",
      error: e instanceof Error ? `خطا در ارتباط با SMS.IR: ${e.message}` : "خطای نامشخص SMS.IR",
    };
  }
}

// ============ Dispatcher ============

export async function sendOtpSms(
  settings: SMSSettings,
  to: string,
  code: string
): Promise<SmsResult> {
  const text = (settings.otpTemplate || "کد تأیید شما: {code}")
    .replaceAll("{code}", code)
    .replaceAll("{ttl}", String(settings.otpTtlMinutes));

  const providerAvailable = settings.provider === "melipayamak" || settings.provider === "smsir";

  // Dev mode / no provider => skip real send (code is shown in UI)
  if (settings.devMode || !providerAvailable) {
    return { success: true, provider: settings.provider, devMode: true };
  }

  if (settings.provider === "melipayamak") {
    // پترن خدماتی تنظیم شده؟ → ارسال OTP از «خط خدماتی اشتراکی» با کد پترن
    // (پترن باید در خود پنل ملی‌پیامک ساخته و تأیید شده باشد و کد آن اینجا ثبت شود)
    const patternCode = (settings.melipayamakPatternCode ?? "").trim();
    if (patternCode) {
      // پترن باید دقیقاً یک متغیر %0 برای کد تأیید داشته باشد
      // (مثال پترن: «رستوران نخل\nکد تأیید شما: %0»)
      const args = [code];
      return settings.melipayamakAuthType === "apikey"
        ? sendMelipayamakConsolePattern(settings, to, args)
        : sendMelipayamakLegacyPattern(settings, to, args);
    }
    return sendMelipayamak(settings, to, text);
  }
  if (settings.provider === "smsir") {
    return sendSmsIr(settings, to, text, code);
  }
  return { success: true, provider: "none", devMode: true };
}

/** Test SMS provider connection from admin panel (no real SMS is sent) */
export async function testSmsProvider(settings: SMSSettings): Promise<SmsResult> {
  if (settings.provider === "melipayamak") {
    // اعتبارسنجی کلید/اعتبار — بدون ارسال پیامک و بدون کسر هزینه
    return testMelipayamakConnection(settings);
  }
  if (settings.provider === "smsir") {
    if (!settings.smsirApiKey) {
      return { success: false, provider: "smsir", error: "کلید API پیامکستان تنظیم نشده است" };
    }
    return {
      success: true,
      provider: "smsir",
      message: "کلید SMS.IR ذخیره شده است — با ارسال اولین کد ورود بررسی واقعی انجام می‌شود",
    };
  }
  return { success: false, provider: "none", error: "هیچ سرویس‌دهنده‌ای انتخاب نشده است" };
}

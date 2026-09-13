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
 *    POST https://console.melipayamak.com/api/send/simple/{token}
 *      body: { from, to, text }          → from الزامی است
 *      پاسخ موفق: { recId: <شناسه> , status: "" }
 *      پاسخ خطا:   { status: "پیام خطا" } یا خطای اعتبارسنجی ASP.NET
 *    GET  https://console.melipayamak.com/api/receive/credit/{token}
 *      پاسخ: { amount: <اعتبار>, status: "" }   → برای «تست اتصال» بدون ارسال پیامک
 *
 * ۲) پنل قدیمی (username/password) — rest.payamak-panel.com
 *    POST https://rest.payamak-panel.com/api/SendSMS/SendSMS  { username, password, to, from, text, isFlash }
 *      RetStatus === 1 ⇒ موفق
 *    POST https://rest.payamak-panel.com/api/SendSMS/GetCredit { username, password }
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
        return {
          success: true,
          provider: "melipayamak",
          credit: amountKnown && Number.isFinite(credit) ? credit : undefined,
          message: `اتصال به کنسول ملی‌پیامک برقرار است ✅${creditStr ? ` — اعتبار پنل: ${creditStr}` : ""}`,
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

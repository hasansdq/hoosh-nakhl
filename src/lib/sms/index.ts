import "server-only";
import type { SMSSettings } from "@/lib/settings";

export interface SmsResult {
  success: boolean;
  error?: string;
  provider: string;
  devMode?: boolean;
}

function toLocalPhone(phone: string): string {
  // 989xxxxxxxxx -> 09xxxxxxxxx
  const p = phone.replace(/\D/g, "");
  return p.startsWith("98") ? `0${p.slice(2)}` : p;
}

// ============ Melipayamak ============

/**
 * ملی‌پیامک
 * - New API-Key: POST https://console.melipayamak.com/api/send/simple/{apiKey}
 * - Legacy:     POST https://rest.payamak-panel.com/api/SendSMS/SendSMS
 */
async function sendMelipayamak(
  settings: SMSSettings,
  to: string,
  text: string
): Promise<SmsResult> {
  const localPhone = toLocalPhone(to);
  try {
    if (settings.melipayamakAuthType === "apikey" && settings.melipayamakApiKey) {
      const url = `https://console.melipayamak.com/api/send/simple/${encodeURIComponent(settings.melipayamakApiKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: settings.melipayamakFrom || undefined,
          to: localPhone,
          text,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        recId?: number;
        code?: number;
        status?: string;
        message?: string;
      };
      // Melipayamak: code 200 & recId > 0 => success
      if (res.ok && (body.code === 200 || body.code === 112 || (body.recId && body.recId > 0))) {
        return { success: true, provider: "melipayamak" };
      }
      return {
        success: false,
        provider: "melipayamak",
        error: body.message || body.status || `خطای پنل ملی‌پیامک (کد ${body.code ?? res.status})`,
      };
    }

    // Legacy username/password
    if (!settings.melipayamakUsername || !settings.melipayamakPassword) {
      return { success: false, provider: "melipayamak", error: "تنظیمات ملی‌پیامک کامل نیست" };
    }
    const res = await fetch("https://rest.payamak-panel.com/api/SendSMS/SendSMS", {
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
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      RetStatus?: number;
      Value?: string;
      StrRetStatus?: string;
    };
    // RetStatus === 1 => success
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

/** Test SMS provider connection from admin panel */
export async function testSmsProvider(settings: SMSSettings): Promise<SmsResult> {
  if (settings.provider === "melipayamak") {
    return sendMelipayamak(settings, "09120000000", "پیام آزمایشی رستوران نخل");
  }
  if (settings.provider === "smsir") {
    return sendSmsIr(settings, "09120000000", "پیام آزمایشی رستوران نخل", "00000");
  }
  return { success: false, provider: "none", error: "هیچ سرویس‌دهنده‌ای انتخاب نشده است" };
}

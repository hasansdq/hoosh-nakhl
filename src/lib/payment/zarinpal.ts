import "server-only";
import type { PaymentSettings } from "@/lib/settings";

const ZARINPAL_BASE = "https://payment.zarinpal.com";
const ZARINPAL_SANDBOX = "https://sandbox.zarinpal.com";

export function zarinpalBaseUrl(settings: PaymentSettings): string {
  return settings.sandbox ? ZARINPAL_SANDBOX : ZARINPAL_BASE;
}

export function startPayUrl(settings: PaymentSettings, authority: string): string {
  return `${zarinpalBaseUrl(settings)}/pg/StartPay/${authority}`;
}

export interface RequestResult {
  success: boolean;
  authority?: string;
  paymentUrl?: string;
  code?: number;
  message?: string;
  simulated?: boolean;
}

export interface VerifyResult {
  success: boolean;
  code?: number;
  refId?: number;
  cardPan?: string;
  message?: string;
}

/** ZarinPal amounts are in RIAL — our prices are Toman */
export function tomanToRial(toman: number): number {
  return toman * 10;
}

/**
 * Request a payment from ZarinPal (v4 API).
 * If no merchant configured or simulation enabled → local simulated authority.
 */
export async function zarinpalRequest(
  settings: PaymentSettings,
  params: {
    amountToman: number;
    callbackUrl: string;
    description: string;
    mobile?: string;
    orderId: string;
  }
): Promise<RequestResult> {
  // PRODUCTION SAFETY: ZARINPAL_FORCE_REAL=1 acts as a hard kill-switch for the
  // simulated gateway — payments then either go through the REAL ZarinPal API
  // (merchantId must be configured) or fail loudly. Never silently "simulate
  // success" in production because a setting was left flipped.
  const forceReal = process.env.ZARINPAL_FORCE_REAL === "1";
  const useSimulation = !forceReal && (settings.simulationMode || !settings.merchantId);

  if (useSimulation) {
    const authority = `SIM-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    return {
      success: true,
      authority,
      paymentUrl: null as unknown as string,
      code: 100,
      message: "درگاه شبیه‌سازی‌شده (حالت آزمایشی)",
      simulated: true,
    };
  }

  try {
    const res = await fetch(`${zarinpalBaseUrl(settings)}/pg/v4/payment/request.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: settings.merchantId,
        amount: tomanToRial(params.amountToman),
        callback_url: params.callbackUrl,
        description: params.description,
        metadata: {
          mobile: params.mobile,
          order_id: params.orderId,
        },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { code?: number; authority?: string; fee?: number; message?: string } | null;
      errors?: { code?: number; message?: string } | unknown[] | null;
    };
    const code = body.data?.code;
    if (code === 100 && body.data?.authority) {
      return {
        success: true,
        authority: body.data.authority,
        paymentUrl: startPayUrl(settings, body.data.authority),
        code,
        message: body.data.message,
      };
    }
    const errMsg =
      (body.errors && !Array.isArray(body.errors) && (body.errors as { message?: string }).message) ||
      body.data?.message ||
      `خطای درگاه زرین‌پال (کد ${code ?? "نامشخص"})`;
    return { success: false, code, message: errMsg };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? `خطا در ارتباط با زرین‌پال: ${e.message}` : "خطای نامشخص درگاه",
    };
  }
}

/** Verify a ZarinPal payment (v4 API) */
export async function zarinpalVerify(
  settings: PaymentSettings,
  params: { amountToman: number; authority: string }
): Promise<VerifyResult> {
  try {
    const res = await fetch(`${zarinpalBaseUrl(settings)}/pg/v4/payment/verify.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: settings.merchantId,
        amount: tomanToRial(params.amountToman),
        authority: params.authority,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { code?: number; ref_id?: number; card_pan?: string; message?: string } | null;
      errors?: { message?: string } | unknown[] | null;
    };
    const code = body.data?.code;
    // 100 = verified, 101 = already verified (success)
    if (code === 100 || code === 101) {
      return {
        success: true,
        code,
        refId: body.data?.ref_id,
        cardPan: body.data?.card_pan,
        message: code === 101 ? "این پرداخت قبلاً تأیید شده است" : body.data?.message,
      };
    }
    const errMsg =
      (body.errors && !Array.isArray(body.errors) && (body.errors as { message?: string }).message) ||
      body.data?.message ||
      `تأیید پرداخت ناموفق (کد ${code ?? "نامشخص"})`;
    return { success: false, code, message: errMsg };
  } catch (e) {
    return {
      success: false,
      message: e instanceof Error ? `خطا در تأیید پرداخت: ${e.message}` : "خطای نامشخص تأیید",
    };
  }
}

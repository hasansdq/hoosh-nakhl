import { NextRequest } from "next/server";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import type { BaranSettings } from "@/lib/settings";

/**
 * تست سرتاسری اتصال باران — POST /api/admin/baran/test
 * ---------------------------------------------------------------------------
 * اتصال باران «ورودی» است (نرم‌افزار باران به سایت وصل می‌شود)، بنابراین تست
 * واقعی یعنی شبیه‌سازی دقیقاً همان چیزی که باران انجام می‌دهد — یک round-trip
 * کامل HTTP روی متد غیرمخرب Ping:
 *
 *   گام ۱) دسترسی endpoint بدون کلید → باید 503 (غیرفعال) یا 401 (الزام کلید) بدهد؛
 *          200 یعنی کلید الزامی نیست (هشدار امنیتی)
 *   گام ۲) رد کلید نامعتبر → دقیقاً همان پاسخی که باران با کلید غلط می‌گیرد
 *   گام ۳) round-trip مجاز با کلید ذخیره‌شده → باید 200 + ok:true بدهد
 *
 * نتیجهٔ هر گام + زمان پاسخ (ms) برگردانده و در AuditLog ثبت می‌شود.
 * هیچ داده‌ای تغییر نمی‌دهد (Ping فقط خواندنی است) و در BaranSyncLog نمی‌نویسد
 * تا لاگ فراخوانی‌های واقعی باران تمیز بماند.
 */

interface StepResult {
  key: string;
  label: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail: string;
  ms: number | null;
}

const TIMEOUT_MS = 8000;

/** origin عمومی از هدرهای پروکسی (Caddy/CDN) — در غیاب آن، origin خود سرور */
function resolveOrigins(req: NextRequest): string[] {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))?.split(",")[0]?.trim();
  const forwarded = proto && host ? `${proto}://${host}` : null;
  const self = req.nextUrl.origin;
  const list = [forwarded, self].filter((o): o is string => !!o);
  return [...new Set(list)];
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const s = await getSettings<BaranSettings>("baran");
    const origins = resolveOrigins(req);
    const steps: StepResult[] = [];

    // ---------- انتخاب origin قابل‌دسترس ----------
    let activeOrigin: string | null = null;
    let reachMs = 0;
    let reachErr: string | null = null;
    for (const origin of origins) {
      const t0 = Date.now();
      try {
        const res = await fetch(`${origin}/api/ApiServiceBaran/Ping`, {
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        reachMs = Date.now() - t0;
        activeOrigin = origin; // هر پاسخ HTTP (حتی 4xx/5xx) یعنی endpoint در دسترس است
        break;
      } catch (e) {
        reachErr = e instanceof Error ? e.message : String(e);
      }
    }

    if (!activeOrigin) {
      steps.push({
        key: "reachable",
        label: "دسترسی به endpoint",
        status: "fail",
        detail: `آدرس پاسخ نداد${reachErr ? ` (${reachErr})` : ""} — سرویس وب یا پروکسی در دسترس نیست`,
        ms: null,
      });
      await logAudit(session.admin.username, "BARAN_CONNECTION_TEST", {
        entity: "settings",
        entityId: "baran",
        detail: { overall: "broken", steps },
        ip: getClientIp(req),
      });
      return ok({ overall: "broken", endpointUrl: null, steps });
    }

    steps.push({
      key: "reachable",
      label: "دسترسی به endpoint",
      status: "pass",
      detail: `آدرس /api/ApiServiceBaran پاسخ داد (${activeOrigin})`,
      ms: reachMs,
    });

    const endpointUrl = `${activeOrigin}/api/ApiServiceBaran/`;

    // ---------- گام ۱: رفتار بدون کلید ----------
    let integrationOff = false;
    {
      const t0 = Date.now();
      const res = await fetch(`${activeOrigin}/api/ApiServiceBaran/Ping`, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ms = Date.now() - t0;
      if (res.status === 503) {
        integrationOff = true;
        steps.push({
          key: "disabled",
          label: "وضعیت فعال‌بودن اتصال",
          status: "fail",
          detail: "اتصال باران غیرفعال است — ابتدا آن را از سوییچ بالای صفحه فعال کنید",
          ms,
        });
        steps.push({
          key: "enforced",
          label: "الزام کلید API",
          status: "skip",
          detail: "تا فعال‌شدن اتصال، این گام معنایی ندارد",
          ms: null,
        });
      } else if (res.status === 401) {
        steps.push({
          key: "enforced",
          label: "الزام کلید API (درخواست بدون کلید)",
          status: "pass",
          detail: "درخواست بدون کلید دقیقاً مانند بارانِ بی‌کلید رد شد (401)",
          ms,
        });
      } else if (res.status === 200) {
        steps.push({
          key: "enforced",
          label: "الزام کلید API (درخواست بدون کلید)",
          status: s.requireKey ? "fail" : "warn",
          detail: s.requireKey
            ? "درخواست بدون کلید پذیرفته شد (200) در حالی که الزام کلید روشن است — تنظیمات ذخیره‌نشده است؛ دوباره ذخیره کنید"
            : "کلید الزامی نیست — هر فراخواننده‌ای می‌تواند کالا ارسال کند؛ توصیه: الزام کلید را روشن کنید",
          ms,
        });
      } else {
        steps.push({
          key: "enforced",
          label: "الزام کلید API (درخواست بدون کلید)",
          status: "warn",
          detail: `پاسخ غیرمنتظره (${res.status}) — احتمالاً پروکسی یا میان‌افزاری در مسیر است`,
          ms,
        });
      }
    }

    // ---------- گام ۲: شبیه‌سازی کلید غلط (فقط وقتی اتصال روشن است — وگرنه همیشه 503 است) ----------
    if (!integrationOff && s.requireKey && s.apiKey) {
      const t0 = Date.now();
      const res = await fetch(`${activeOrigin}/api/ApiServiceBaran/Ping?apikey=wrong-key-test`, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ms = Date.now() - t0;
      steps.push({
        key: "wrong-key",
        label: "رد کلید نامعتبر",
        status: res.status === 401 ? "pass" : "fail",
        detail:
          res.status === 401
            ? "کلید اشتباه رد شد (401) — اگر باران 401 می‌گیرد، کلید را در نرم‌افزار به‌روزرسانی کنید"
            : `کلید اشتباه پذیرفته شد (${res.status}) — نشت احتمالی؛ کلید را بازتولید کنید`,
        ms,
      });
    }

    // ---------- گام ۳: round-trip مجاز (دقیقاً مسیر موفق باران — فقط وقتی اتصال روشن است) ----------
    if (integrationOff) {
      steps.push({
        key: "authorized",
        label: "فراخوانی endpoint",
        status: "skip",
        detail: "اتصال غیرفعال بود — پس از فعال‌کردن دوباره تست بگیرید",
        ms: null,
      });
    } else {
      const headers: Record<string, string> = {};
      if (s.requireKey && s.apiKey) headers["x-api-key"] = s.apiKey;
      const t0 = Date.now();
      try {
        const res = await fetch(`${activeOrigin}/api/ApiServiceBaran/Ping`, {
          headers,
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const ms = Date.now() - t0;
        const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (res.status === 200 && body?.ok === true) {
          steps.push({
            key: "authorized",
            label: s.requireKey ? "فراخوانی با کلید معتبر" : "فراخوانی endpoint",
            status: "pass",
            detail: "پاسخ معتبر گرفت — همان مسیری که نرم‌افزار باران با موفقیت طی می‌کند",
            ms,
          });
        } else if (res.status === 503) {
          steps.push({
            key: "authorized",
            label: s.requireKey ? "فراخوانی با کلید معتبر" : "فراخوانی endpoint",
            status: "fail",
            detail: "اتصال در حین تست غیرفعال شد (503)",
            ms,
          });
        } else {
          steps.push({
            key: "authorized",
            label: s.requireKey ? "فراخوانی با کلید معتبر" : "فراخوانی endpoint",
            status: "fail",
            detail: `پاسخ غیرمنتظره (${res.status}) — کلید ذخیره‌شده با کلید الزامی تنظیمات نمی‌خواند`,
            ms,
          });
        }
      } catch (e) {
        steps.push({
          key: "authorized",
          label: s.requireKey ? "فراخوانی با کلید معتبر" : "فراخوانی endpoint",
          status: "fail",
          detail: `خطای شبکه: ${e instanceof Error ? e.message : String(e)}`,
          ms: null,
        });
      }
    }

    const fails = steps.filter((x) => x.status === "fail").length;
    const warns = steps.filter((x) => x.status === "warn").length;
    const overall = fails > 0 ? "broken" : warns > 0 ? "issues" : "healthy";

    await logAudit(session.admin.username, "BARAN_CONNECTION_TEST", {
      entity: "settings",
      entityId: "baran",
      detail: { overall, steps },
      ip: getClientIp(req),
    });

    return ok({ overall, endpointUrl, steps });
  } catch (e) {
    console.error("baran connection test error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

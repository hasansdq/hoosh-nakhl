import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";

/**
 * ارسال مجدد سفارش‌ها به باران — /api/admin/baran/resend-orders
 * ---------------------------------------------------------------------------
 * باران تأیید دریافت را با ClearOrders اعلام می‌کند و سفارش‌ها «ارسال‌شده»
 * می‌شوند. اگر داده‌ها در نرم‌افزار گم شد (نصب مجدد و…)، این عملیات پرچم
 * ارسال را پاک می‌کند تا سفارش‌ها دوباره در GET Orders برگردند.
 *
 * بدنه: { factorNumbers?: number[] } — خالی = همهٔ سفارش‌های ارسال‌شده
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const body = await req.json().catch(() => ({}));
    const factorNumbers = Array.isArray(body.factorNumbers)
      ? body.factorNumbers.filter((n: unknown): n is number => typeof n === "number" && n > 0)
      : [];

    const where =
      factorNumbers.length > 0
        ? { baranSentAt: { not: null }, baranFactorNumber: { in: factorNumbers } }
        : { baranSentAt: { not: null } };

    const result = await db.order.updateMany({
      where,
      data: { baranSentAt: null },
    });

    await logAudit(session.admin.username, "BARAN_ORDERS_RESENT", {
      entity: "order",
      detail: { count: result.count, factorNumbers: factorNumbers.length ? factorNumbers : "all" },
      ip: getClientIp(req),
    });

    return ok({ count: result.count });
  } catch (e) {
    console.error("baran resend-orders error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

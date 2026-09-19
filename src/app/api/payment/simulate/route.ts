import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser, logAudit } from "@/lib/api";
import { notifyAdmins, notifyCustomer } from "@/lib/notify";

/**
 * Simulated gateway completion (used when simulation mode is ON in payment settings).
 * POST { authority: string, success: boolean }
 *
 * PRODUCTION SAFETY (hard guards — see user request «پرداخت آزمایشی کاملاً غیرفعال
 * در نسخه نهایی»):
 *   1. ZARINPAL_FORCE_REAL=1 (default ON in docker-compose) → the endpoint is
 *      dead: 403 for everyone, no exceptions.
 *   2. Even without the kill-switch, ONLY orders whose paymentAuthority was
 *      ISSUED by the local simulator ("SIM-*" prefix) can be completed here.
 *      A real ZarinPal authority must never be markable through this route —
 *      previously a logged-in user could have “paid” their real-gateway order
 *      for free by POSTing their own authority here.
 */
export async function POST(req: NextRequest) {
  try {
    // Guard 1 — global kill-switch (docker-compose sets it to "1" by default)
    if (process.env.ZARINPAL_FORCE_REAL === "1") {
      return fail("دروازهٔ آزمایشی پرداخت در این استقرار غیرفعال است", 403);
    }

    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const body = (await req.json().catch(() => ({}))) as { authority?: string; success?: boolean };
    if (!body.authority) return fail("شناسه تراکنش نامعتبر است");

    const order = await db.order.findFirst({
      where: { paymentAuthority: body.authority, userId: user.id },
    });
    if (!order) return fail("تراکنش یافت نشد", 404);

    // Guard 2 — only simulator-issued authorities (SIM-*) may be completed here
    if (!order.paymentAuthority?.startsWith("SIM-")) {
      await logAudit(user.id, "PAYMENT_SIMULATE_REJECTED_REAL_AUTHORITY", {
        entity: "order",
        entityId: order.id,
        detail: { orderNumber: order.orderNumber, authority: body.authority.slice(0, 64) },
      });
      return fail("این تراکنش از درگاه واقعی است و از مسیر آزمایشی قابل تکمیل نیست", 403);
    }

    if (order.paymentStatus === "PAID") {
      return ok({ status: "PAID", orderNumber: order.orderNumber });
    }

    if (body.success) {
      const fakeRef = Math.floor(10_000_000 + Math.random() * 89_999_999);
      await db.order.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentStatus: "PAID",
          paymentRef: String(fakeRef),
          paymentCard: "6037-99**-****-1234",
          paidAt: new Date(),
          paymentError: null,
        },
      });
      await db.orderStatusLog.create({
        data: { orderId: order.id, status: "PAID", note: `پرداخت آزمایشی موفق — کد رهگیری ${fakeRef}` },
      });
      const items = await db.orderItem.findMany({ where: { orderId: order.id } });
      for (const it of items) {
        if (it.menuItemId) {
          await db.menuItem.update({
            where: { id: it.menuItemId },
            data: { orderCount: { increment: it.quantity } },
          });
        }
      }
      // increment coupon usage
      if (order.couponCode) {
        await db.coupon.update({
          where: { code: order.couponCode },
          data: { usedCount: { increment: 1 } },
        }).catch(() => null);
      }
      // real-time push to admin panel
      await notifyAdmins("order:new-paid", {
        orderNumber: order.orderNumber,
        total: order.total,
        userName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.phone,
        type: order.type,
      });
      // real-time push to the customer tracking this order
      // (transition PENDING_PAYMENT → PAID, so they see their own payment success
      //  live on the /track page if they have it open in another tab)
      await notifyCustomer(order.orderNumber, "customer:order-status", {
        orderNumber: order.orderNumber,
        status: "PAID",
        statusLabel: "پرداخت شد",
        from: order.status,
        to: "PAID",
      });
      await logAudit(user.id, "PAYMENT_SIMULATED_SUCCESS", { entity: "order", entityId: order.id });
      return ok({ status: "PAID", orderNumber: order.orderNumber, ref: fakeRef });
    }

    await db.order.update({
      where: { id: order.id },
      data: {
        status: "PAYMENT_FAILED",
        paymentStatus: "FAILED",
        paymentError: "پرداخت آزمایشی ناموفق — خطای شبیه‌سازی‌شده درگاه",
      },
    });
    await db.orderStatusLog.create({
      data: { orderId: order.id, status: "PAYMENT_FAILED", note: "پرداخت آزمایشی ناموفق" },
    });
    await logAudit(user.id, "PAYMENT_SIMULATED_FAILED", { entity: "order", entityId: order.id });
    return ok({ status: "FAILED", orderNumber: order.orderNumber });
  } catch (e) {
    console.error("simulate error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

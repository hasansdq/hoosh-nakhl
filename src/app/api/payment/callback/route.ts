import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSettings, type PaymentSettings } from "@/lib/settings";
import { zarinpalVerify } from "@/lib/payment/zarinpal";
import { notifyAdmins, notifyCustomer } from "@/lib/notify";
import { notifyChatPaymentSuccess, notifyChatPaymentFailed } from "@/lib/chat/payment-chat";
import { publicUrl } from "@/lib/public-url";

export async function GET(req: NextRequest) {
  const redirect = (path: string) => Response.redirect(publicUrl(req, path), 302);
  try {
    const url = new URL(req.url);
    const authority = url.searchParams.get("Authority") ?? url.searchParams.get("authority");
    const status = (url.searchParams.get("Status") ?? url.searchParams.get("status") ?? "").toUpperCase();
    if (!authority) return redirect("/?payment=failed&reason=noauth");
    const attempt = await db.paymentAttempt.findUnique({ where: { authority } });
    const order = await db.order.findFirst({
      where: attempt ? { id: attempt.orderId } : { paymentAuthority: authority },
      include: { user: { select: { firstName: true, lastName: true, phone: true } } },
    });
    if (!order) return redirect("/?payment=failed&reason=notfound");
    const success = () => redirect(`/?payment=success&order=${encodeURIComponent(order.orderNumber)}`);
    if (order.paymentStatus === "PAID") return success();
    const saved = await getSettings<PaymentSettings>("payment");
    const settings = attempt ? { ...saved, merchantId: attempt.merchantId, sandbox: attempt.sandbox } : saved;
    const verify = status === "OK"
      ? await zarinpalVerify(settings, { amountToman: attempt?.amountToman ?? order.total, authority })
      : { success: false, message: "پرداخت لغو شد یا ناموفق بود", refId: undefined, cardPan: undefined };

    // The paid transition, status log, popularity and coupon usage are atomic.
    // Only the request which wins this conditional transition runs side effects.
    const updated = await db.$transaction(async tx => {
      const changed = await tx.order.updateMany({
        where: verify.success
          ? { id: order.id, paymentStatus: { not: "PAID" } }
          : { id: order.id, paymentAuthority: authority, paymentStatus: "PENDING" },
        data: verify.success ? {
          status: "PAID", paymentStatus: "PAID", paymentAuthority: authority,
          paymentRef: verify.refId ? String(verify.refId) : null,
          paymentCard: verify.cardPan ?? null, paidAt: new Date(), paymentError: null,
        } : { status: "PAYMENT_FAILED", paymentStatus: "FAILED", paymentError: verify.message ?? "تأیید پرداخت ناموفق بود" },
      });
      if (!changed.count) return null;
      await tx.orderStatusLog.create({ data: {
        orderId: order.id, status: verify.success ? "PAID" : "PAYMENT_FAILED",
        note: verify.success ? `پرداخت تأیید شد — کد رهگیری ${verify.refId ?? "-"}` : verify.message ?? "خطای تأیید پرداخت",
      } });
      if (verify.success) {
        const items = await tx.orderItem.findMany({ where: { orderId: order.id } });
        for (const item of items) if (item.menuItemId) {
          await tx.menuItem.updateMany({ where: { id: item.menuItemId }, data: { orderCount: { increment: item.quantity } } });
        }
        if (order.couponCode) await tx.coupon.updateMany({ where: { code: order.couponCode }, data: { usedCount: { increment: 1 } } });
      }
      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, statusLogs: { orderBy: { createdAt: "asc" } } } });
    });
    if (updated) {
      // Notification failure cannot undo or misreport an already recorded payment.
      const payload = { ...updated, items: updated.items.map(i => ({ name: i.name, quantity: i.quantity })) };
      await Promise.allSettled(verify.success ? [
        notifyAdmins("order:new-paid", { orderNumber: order.orderNumber, total: order.total, userName: `${order.user.firstName ?? ""} ${order.user.lastName ?? ""}`.trim() || order.user.phone, type: order.type }),
        notifyCustomer(order.orderNumber, "customer:order-status", { orderNumber: order.orderNumber, status: "PAID", statusLabel: "پرداخت شد", from: order.status, to: "PAID" }),
        notifyChatPaymentSuccess(payload),
      ] : [notifyChatPaymentFailed(payload)]);
    }
    const current = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    if (current.paymentStatus === "PAID") return success();
    return redirect(`/?payment=failed&order=${encodeURIComponent(order.orderNumber)}&reason=${status === "OK" ? "verify" : "canceled"}`);
  } catch (error) {
    console.error("payment callback error:", error);
    return redirect("/?payment=failed&reason=error");
  }
}

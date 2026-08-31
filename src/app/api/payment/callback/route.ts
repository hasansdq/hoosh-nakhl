import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSettings, type PaymentSettings } from "@/lib/settings";
import { zarinpalVerify } from "@/lib/payment/zarinpal";
import { notifyAdmins, notifyCustomer } from "@/lib/notify";

/**
 * ZarinPal gateway callback:
 * GET /api/payment/callback?Authority=xxx&Status=OK|NOK
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const authority = url.searchParams.get("Authority") ?? url.searchParams.get("authority");
    const status = (url.searchParams.get("Status") ?? url.searchParams.get("status") ?? "").toUpperCase();

    if (!authority) {
      return Response.redirect(new URL("/?payment=failed&reason=noauth", url.origin), 302);
    }

    const order = await db.order.findFirst({
      where: { paymentAuthority: authority },
      include: { user: { select: { firstName: true, lastName: true, phone: true } } },
    });
    if (!order) {
      return Response.redirect(new URL("/?payment=failed&reason=notfound", url.origin), 302);
    }

    // already processed
    if (order.paymentStatus === "PAID") {
      return Response.redirect(new URL(`/?payment=success&order=${order.orderNumber}`, url.origin), 302);
    }

    if (status !== "OK") {
      await db.order.update({
        where: { id: order.id },
        data: {
          status: "PAYMENT_FAILED",
          paymentStatus: "FAILED",
          paymentError: "پرداخت توسط شما لغو شد یا ناموفق بود",
        },
      });
      await db.orderStatusLog.create({
        data: { orderId: order.id, status: "PAYMENT_FAILED", note: "لغو/خطای پرداخت در درگاه" },
      });
      return Response.redirect(new URL(`/?payment=failed&order=${order.orderNumber}&reason=canceled`, url.origin), 302);
    }

    // verify
    const settings = await getSettings<PaymentSettings>("payment");
    const verify = await zarinpalVerify(settings, { amountToman: order.total, authority });

    if (verify.success) {
      await db.order.update({
        where: { id: order.id },
        data: {
          status: "PAID",
          paymentStatus: "PAID",
          paymentRef: verify.refId ? String(verify.refId) : null,
          paymentCard: verify.cardPan ?? null,
          paidAt: new Date(),
          paymentError: null,
        },
      });
      await db.orderStatusLog.create({
        data: { orderId: order.id, status: "PAID", note: `پرداخت تأیید شد — کد رهگیری ${verify.refId ?? "-"}` },
      });
      // increment popularity
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
        userName: `${order.user?.firstName ?? ""} ${order.user?.lastName ?? ""}`.trim() || order.user?.phone || "-",
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
      return Response.redirect(new URL(`/?payment=success&order=${order.orderNumber}&ref=${verify.refId ?? ""}`, url.origin), 302);
    }

    await db.order.update({
      where: { id: order.id },
      data: {
        status: "PAYMENT_FAILED",
        paymentStatus: "FAILED",
        paymentError: verify.message ?? "تأیید پرداخت ناموفق بود",
      },
    });
    await db.orderStatusLog.create({
      data: { orderId: order.id, status: "PAYMENT_FAILED", note: verify.message ?? "خطای تأیید" },
    });
    return Response.redirect(new URL(`/?payment=failed&order=${order.orderNumber}&reason=verify`, url.origin), 302);
  } catch (e) {
    console.error("payment callback error:", e);
    const url = new URL(req.url);
    return Response.redirect(new URL("/?payment=failed&reason=error", url.origin), 302);
  }
}

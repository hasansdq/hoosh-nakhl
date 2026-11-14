import "server-only";
import { db } from "@/lib/db";
import type { PaymentSettings } from "@/lib/settings";

// Preserve every issued authority, including the legacy authority on first retry.
export async function recordPaymentAttempt(orderId: string, authority: string, settings: PaymentSettings) {
  return db.$transaction(async tx => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.paymentStatus === "PAID" || order.status === "CANCELED") throw new Error("این سفارش قابل پرداخت مجدد نیست");
    const data = { orderId, merchantId: settings.merchantId, sandbox: settings.sandbox && process.env.ZARINPAL_FORCE_REAL !== "1", amountToman: order.total };
    if (order.paymentAuthority) {
      await tx.paymentAttempt.upsert({ where: { authority: order.paymentAuthority }, create: { ...data, authority: order.paymentAuthority }, update: {} });
    }
    await tx.paymentAttempt.create({ data: { ...data, authority } });
    return tx.order.update({ where: { id: orderId }, data: { paymentAuthority: authority, paymentStatus: "PENDING", status: "PENDING_PAYMENT", paymentError: null } });
  });
}

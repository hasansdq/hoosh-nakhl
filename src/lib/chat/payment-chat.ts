import "server-only";
import { db } from "@/lib/db";
import { trackingPayloadFromOrder } from "@/lib/chat/engine";
import { toPersianDigits } from "@/lib/fa";

/**
 * Append an assistant message to the conversation the order belongs to (falls
 * back to the user's active conversation). Used right after a payment succeeds
 * or fails, so the customer sees the final verdict + tracking code directly
 * inside the Nakhl AI chat.
 */
async function appendToOrderConversation(
  userId: string,
  orderId: string | null,
  content: string,
  metadata: Record<string, unknown>
) {
  try {
    const session = (orderId
      ? await db.chatSession.findFirst({
          where: { orderId, userId },
          orderBy: { updatedAt: "desc" },
        })
      : null) ??
      (await db.chatSession.findFirst({
        where: { userId, status: "ACTIVE" },
        orderBy: { updatedAt: "desc" },
      }));
    if (!session) return;

    await db.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "ASSISTANT",
        content,
        type: "TEXT",
        metadata: JSON.stringify(metadata),
      },
    });
    await db.chatSession.update({
      where: { id: session.id },
      data: { stage: "TRACKING", orderId: orderId ?? undefined, updatedAt: new Date() },
    });
  } catch (e) {
    console.error("appendToOrderConversation failed:", e);
  }
}

type TrackableOrder = {
  id: string;
  userId: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  type: string;
  createdAt: Date;
  paymentError?: string | null;
  paymentRef?: string | null;
  items: { name: string; quantity: number }[];
  statusLogs: { status: string; createdAt: Date }[];
};

/** Success: order finalized — tracking code + live status card in the chat */
export async function notifyChatPaymentSuccess(order: TrackableOrder) {
  const ref = order.paymentRef ? toPersianDigits(order.paymentRef) : null;
  const lines = [
    "پرداخت با موفقیت انجام شد و سفارش شما نهایی شد! 🎉",
    `شماره سفارش: ${order.orderNumber}`,
    ref ? `کد رهگیری پرداخت: ${ref}` : null,
    "آشپزخانه نخل از همین حالا سفارشتان را آماده می‌کند — وضعیت لحظه‌ای را در کارت زیر دنبال کنید.",
  ].filter(Boolean);

  await appendToOrderConversation(order.userId, order.id, lines.join("\n"), {
    stage: "TRACKING",
    tracking: trackingPayloadFromOrder(order),
    paymentSuccess: true,
  });
}

/** Pending: order created, waiting for the gateway — live retry card in chat */
export async function notifyChatPaymentPending(order: TrackableOrder) {
  const content = [
    "سفارش شما ثبت شد و در انتظار پرداخت است 🧾",
    `شماره سفارش: ${order.orderNumber}`,
    "پس از تکمیل پرداخت، سفارش نهایی می‌شود و کد رهگیری دریافت می‌کنید. اگر پرداخت را نبستید یا خطا داد، از دکمه «پرداخت مجدد» در کارت زیر استفاده کنید — یا برای تغییر سفارش همین‌جا بنویسید.",
  ].join("\n");

  await appendToOrderConversation(order.userId, order.id, content, {
    stage: "TRACKING",
    tracking: trackingPayloadFromOrder(order),
    paymentPending: true,
  });
}

/** Failure: keep the order editable + offer retry, right inside the chat */
export async function notifyChatPaymentFailed(order: TrackableOrder) {
  const content = [
    "پرداخت ناموفق بود 😔 اما نگران نباشید — مبلغی از حساب شما کسر نشده است.",
    `شماره سفارش: ${order.orderNumber}`,
    "می‌توانید از دکمه «پرداخت مجدد» در کارت زیر استفاده کنید، یا اگر می‌خواهید سفارش را تغییر بدهید همین‌جا بنویسید تا فاکتور را برایتان باز کنم.",
  ].join("\n");

  await appendToOrderConversation(order.userId, order.id, content, {
    stage: "TRACKING",
    tracking: trackingPayloadFromOrder(order),
    paymentFailed: true,
  });
}

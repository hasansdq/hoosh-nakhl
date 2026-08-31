import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { rateLimit, getClientIp } from "@/lib/auth";
import { normalizePhone, toEnglishDigits } from "@/lib/fa";
import { ORDER_STATUS_LABELS } from "@/lib/chat/engine";

// ============ POST /api/orders/track — رهگیری عمومی سفارش (بدون ورود) ============
// ورودی: شماره سفارش + شماره موبایل صاحب سفارش (تطبیق ۱۰ رقم آخر)

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`track:${ip}`, 15, 60 * 1000);
    if (!rl.ok) return fail("درخواست‌های زیاد؛ لطفاً کمی بعد دوباره امتحان کنید", 429);

    const body = (await req.json().catch(() => ({}))) as { orderNumber?: unknown; phone?: unknown };

    const orderNumber =
      typeof body.orderNumber === "string"
        ? toEnglishDigits(body.orderNumber).trim().toUpperCase().replace(/\s+/g, "")
        : "";
    if (!orderNumber || orderNumber.length < 4 || orderNumber.length > 24) {
      return fail("شماره سفارش را صحیح وارد کنید (مثلاً NK-1234)");
    }

    const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : null;
    if (!phone) return fail("شماره موبایل معتبر نیست");

    const order = await db.order.findUnique({
      where: { orderNumber },
      include: {
        items: true,
        statusLogs: { orderBy: { createdAt: "asc" } },
        user: { select: { phone: true } },
      },
    });

    // phone must match the order owner (compare last 10 digits)
    if (!order || order.user.phone.slice(-10) !== phone.slice(-10)) {
      return fail("سفارشی با این شماره یافت نشد", 404);
    }

    // public-safe payload: no userId, no raw address
    return ok({
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
        paymentStatus: order.paymentStatus,
        type: order.type,
        total: order.total,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        discount: order.discount,
        taxAmount: order.taxAmount,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        scheduledFor: order.scheduledFor ? order.scheduledFor.toISOString() : null,
        items: order.items.map((i) => ({ name: i.name, quantity: i.quantity })),
        statusLogs: order.statusLogs.map((l) => ({
          status: l.status,
          label: ORDER_STATUS_LABELS[l.status] ?? l.status,
          note: l.note,
          createdAt: l.createdAt.toISOString(),
        })),
      },
    });
  } catch (e) {
    console.error("order track error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

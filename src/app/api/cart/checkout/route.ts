import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser, logAudit } from "@/lib/api";
import { getSettings, type PaymentSettings, type GeneralSettings } from "@/lib/settings";
import { zarinpalRequest } from "@/lib/payment/zarinpal";
import { computePricing } from "@/lib/chat/engine";
import { checkCoupon } from "@/lib/coupons";
import { rateLimit } from "@/lib/auth";
import { formatToman, formatJalali } from "@/lib/fa";
import { validateScheduleSlot } from "@/lib/schedule";

// ============ POST /api/cart/checkout — سبد خرید: ثبت سفارش + درخواست پرداخت (STRICT) ============

interface CartCheckoutBody {
  items?: { itemId?: unknown; quantity?: unknown }[];
  deliveryMethod?: unknown;
  couponCode?: unknown;
  address?: unknown;
  note?: unknown;
  scheduledFor?: unknown; // ISO string — زمان تحویل پیش‌سفارش (اختیاری)
}

const MAX_QTY_PER_ITEM = 30;

function genOrderNumber(): string {
  return `NK-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const rl = rateLimit(`pay:${user.id}`, 8, 5 * 60 * 1000);
    if (!rl.ok) return fail("درخواست‌های پرداخت بیش از حد مجاز", 429);

    const body = (await req.json().catch(() => ({}))) as CartCheckoutBody;
    const deliveryMethod = body.deliveryMethod === "PICKUP" ? "PICKUP" : "DELIVERY";
    const address = (typeof body.address === "string" ? body.address : "").trim().slice(0, 500);
    const couponCode = (typeof body.couponCode === "string" ? body.couponCode : "").trim().slice(0, 24);
    const note = typeof body.note === "string" ? body.note.slice(0, 300) : null;

    // ---- پیش‌سفارش: اعتبارسنجی زمان تحویل (۴۵ دقیقه تا ۷ روز آینده، ساعت ۱۲ تا ۲۳:۵۹) ----
    let scheduledForDate: Date | null = null;
    if (body.scheduledFor !== undefined && body.scheduledFor !== null && body.scheduledFor !== "") {
      const sv = validateScheduleSlot(
        body.scheduledFor instanceof Date ? body.scheduledFor : String(body.scheduledFor)
      );
      if (!sv.ok) return fail(sv.reason, 400);
      scheduledForDate = sv.date;
    }

    // ---- normalize items ----
    const seen = new Map<string, number>();
    for (const raw of Array.isArray(body.items) ? body.items : []) {
      const itemId = typeof raw?.itemId === "string" ? raw.itemId : null;
      if (!itemId) continue;
      const qty = Math.max(1, Math.min(MAX_QTY_PER_ITEM, Math.floor(Number(raw?.quantity) || 1)));
      seen.set(itemId, Math.min(MAX_QTY_PER_ITEM, (seen.get(itemId) ?? 0) + qty));
    }
    if (seen.size === 0) return fail("سبد خرید شما خالی است");

    if (deliveryMethod === "DELIVERY" && address.length < 10) {
      return fail("برای ارسال با پیک، آدرس کامل الزامی است");
    }

    // ---- verify items exist & available & re-price from DB (never trust client prices) ----
    const ids = [...seen.keys()];
    const menuItems = await db.menuItem.findMany({ where: { id: { in: ids }, isAvailable: true } });
    const items = [...seen]
      .map(([itemId, quantity]) => {
        const mi = menuItems.find((m) => m.id === itemId);
        if (!mi) return null;
        return {
          menuItemId: mi.id,
          name: mi.name,
          unitPrice: mi.price,
          quantity,
          lineTotal: mi.price * quantity,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (items.length === 0) {
      return fail("آیتم‌های سبد دیگر معتبر نیستند. لطفاً سبد خود را به‌روز کنید");
    }

    const general = await getSettings<GeneralSettings>("general");
    const paymentSettings = await getSettings<PaymentSettings>("payment");

    // ---- coupon: STRICT server-side check ----
    let discount = 0;
    let appliedCouponCode: string | null = null;
    if (couponCode) {
      const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
      const couponCheck = await checkCoupon(couponCode, user.id, subtotal);
      if (!couponCheck.valid) {
        return fail(`کد تخفیف قابل اعمال نیست: ${couponCheck.reason}`);
      }
      discount = couponCheck.discount;
      appliedCouponCode = couponCheck.coupon?.code ?? null;
    }

    // ---- authoritative pricing ----
    const pricing = computePricing(
      {
        items: items.map((i) => ({ itemId: i.menuItemId, name: i.name, price: i.unitPrice, quantity: i.quantity })),
        deliveryMethod,
        address,
        couponCode: appliedCouponCode ?? undefined,
      },
      general,
      discount
    );

    if (general.minOrderAmount > 0 && pricing.subtotal < general.minOrderAmount) {
      return fail(`حداقل مبلغ سفارش ${formatToman(general.minOrderAmount)} است`);
    }

    // ---- create order (PENDING_PAYMENT) with items + status log ----
    const order = await db.order.create({
      data: {
        orderNumber: genOrderNumber(),
        userId: user.id,
        type: deliveryMethod,
        status: "PENDING_PAYMENT",
        address: deliveryMethod === "DELIVERY" ? address : null,
        note,
        scheduledFor: scheduledForDate,
        subtotal: pricing.subtotal,
        deliveryFee: pricing.deliveryFee,
        taxRate: general.taxPercent / 100,
        taxAmount: pricing.taxAmount,
        discount: pricing.discount,
        couponCode: appliedCouponCode,
        total: pricing.total,
        paymentStatus: "PENDING",
        items: {
          create: items.map((i) => ({
            menuItemId: i.menuItemId,
            name: i.name,
            unitPrice: i.unitPrice,
            quantity: i.quantity,
            lineTotal: i.lineTotal,
          })),
        },
        statusLogs: {
          // نوت پایه دست‌نخورده می‌ماند (match های دیگر روی آن کار می‌کنند)؛suffix پیش‌سفارش فقط داخل پرانتز
          create: {
            status: "PENDING_PAYMENT",
            note: scheduledForDate
              ? `سفارش از سبد خرید ثبت شد (پیش‌سفارش برای ${formatJalali(scheduledForDate, true)})`
              : "سفارش از سبد خرید ثبت شد",
          },
        },
      },
      include: { items: true },
    });

    // ---- request payment (mirrors /api/payment/request) ----
    const callbackUrl =
      paymentSettings.callbackUrl ||
      `${new URL(req.url).origin}/api/payment/callback`;

    const payResult = await zarinpalRequest(paymentSettings, {
      amountToman: order.total,
      callbackUrl,
      description: `${paymentSettings.description} — سفارش ${order.orderNumber}`,
      mobile: user.phone,
      orderId: order.id,
    });

    if (!payResult.success || !payResult.authority) {
      await db.order.update({
        where: { id: order.id },
        data: {
          status: "PAYMENT_FAILED",
          paymentStatus: "FAILED",
          paymentError: payResult.message ?? "خطای ایجاد تراکنش",
        },
      });
      return fail(`خطا در اتصال به درگاه پرداخت: ${payResult.message ?? "نامشخص"}`, 502, {
        orderId: order.id,
        orderNumber: order.orderNumber,
      });
    }

    await db.order.update({
      where: { id: order.id },
      data: { paymentAuthority: payResult.authority },
    });

    await logAudit(user.id, "PAYMENT_REQUESTED", {
      entity: "order",
      entityId: order.id,
      detail: {
        orderNumber: order.orderNumber,
        total: order.total,
        simulated: payResult.simulated,
        coupon: appliedCouponCode,
        scheduledFor: scheduledForDate ? scheduledForDate.toISOString() : null,
        source: "cart",
      },
    });

    return ok({
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: order.total,
      authority: payResult.authority,
      simulated: !!payResult.simulated,
      paymentUrl: payResult.paymentUrl ?? undefined,
    });
  } catch (e) {
    console.error("cart checkout error:", e);
    return fail("خطای داخلی در ثبت سفارش", 500);
  }
}

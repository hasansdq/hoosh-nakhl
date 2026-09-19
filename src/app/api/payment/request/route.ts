import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser, logAudit } from "@/lib/api";
import { getSettings, type PaymentSettings, type GeneralSettings } from "@/lib/settings";
import { zarinpalRequest } from "@/lib/payment/zarinpal";
import { getPublicOrigin } from "@/lib/public-url";
import { parseDraft, computePricing } from "@/lib/chat/engine";
import { checkCoupon } from "@/lib/coupons";
import { rateLimit } from "@/lib/auth";
import { formatJalali } from "@/lib/fa";
import { validateScheduleSlot } from "@/lib/schedule";

function genOrderNumber(): string {
  return `NK-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const rl = rateLimit(`pay:${user.id}`, 8, 5 * 60 * 1000);
    if (!rl.ok) return fail("درخواست‌های پرداخت بیش از حد مجاز", 429);

    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: string;
      address?: string;
      note?: string;
      scheduledFor?: string; // ISO — زمان تحویل پیش‌سفارش (اختیاری)
    };

    // پیش‌سفارش (اختیاری): اعتبارسنجی زمان تحویل
    let scheduledForDate: Date | null = null;
    if (body.scheduledFor) {
      const sv = validateScheduleSlot(body.scheduledFor);
      if (!sv.ok) return fail(sv.reason, 400);
      scheduledForDate = sv.date;
    }

    // find active chat session
    const session = await db.chatSession.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
    if (!session) return fail("گفتگوی فعالی یافت نشد. با هوش نخل سفارش خود را ثبت کنید");

    const draft = parseDraft(session.draft);
    if (!draft.items || draft.items.length === 0) {
      return fail("سبد سفارش شما خالی است");
    }
    if (!draft.deliveryMethod) {
      return fail("ابتدا روش تحویل (پیک یا بیرونبر) را مشخص کنید");
    }

    // address override from UI (final confirmation box)
    const address = (body.address ?? draft.address ?? "").trim();
    if (draft.deliveryMethod === "DELIVERY" && address.length < 10) {
      return fail("برای ارسال با پیک، آدرس کامل الزامی است");
    }

    // verify items exist & available & re-price from DB (never trust draft prices)
    const menuItems = await db.menuItem.findMany({ where: { isAvailable: true } });
    const items = draft.items
      .map((d) => {
        const mi = menuItems.find((m) => m.id === d.itemId);
        if (!mi) return null;
        const qty = Math.max(1, Math.min(30, d.quantity));
        return {
          menuItemId: mi.id,
          name: mi.name,
          unitPrice: mi.price, // authoritative price from DB
          quantity: qty,
          lineTotal: mi.price * qty,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (items.length === 0) return fail("آیتم‌های سبد دیگر معتبر نیستند. لطفاً دوباره انتخاب کنید");

    const general = await getSettings<GeneralSettings>("general");
    const paymentSettings = await getSettings<PaymentSettings>("payment");

    // recompute with authoritative data
    const authoritativeDraft = {
      items: items.map((i) => ({ itemId: i.menuItemId, name: i.name, price: i.unitPrice, quantity: i.quantity })),
      deliveryMethod: draft.deliveryMethod,
      address,
      couponCode: draft.couponCode,
    };

    // validate & apply coupon (server-side authoritative check)
    let discount = 0;
    let appliedCouponCode: string | null = null;
    if (draft.couponCode) {
      const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
      const couponCheck = await checkCoupon(draft.couponCode, user.id, subtotal);
      if (!couponCheck.valid) {
        return fail(`کد تخفیف قابل اعمال نیست: ${couponCheck.reason}`);
      }
      discount = couponCheck.discount;
      appliedCouponCode = couponCheck.coupon?.code ?? null;
    }

    const pricing = computePricing(authoritativeDraft, general, discount);

    if (general.minOrderAmount > 0 && pricing.subtotal < general.minOrderAmount) {
      return fail(`حداقل مبلغ سفارش ${general.minOrderAmount.toLocaleString("en-US")} تومان است`);
    }

    // create order
    const order = await db.order.create({
      data: {
        orderNumber: genOrderNumber(),
        userId: user.id,
        type: draft.deliveryMethod,
        status: "PENDING_PAYMENT",
        address: draft.deliveryMethod === "DELIVERY" ? address : null,
        note: body.note?.slice(0, 300) ?? null,
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
          create: {
            status: "PENDING_PAYMENT",
            note: scheduledForDate
              ? `سفارش ایجاد شد — در انتظار پرداخت (پیش‌سفارش برای ${formatJalali(scheduledForDate, true)})`
              : "سفارش ایجاد شد — در انتظار پرداخت",
          },
        },
      },
      include: { items: true },
    });

    // update session → TRACKING + clear draft
    await db.chatSession.update({
      where: { id: session.id },
      data: { stage: "TRACKING", orderId: order.id, draft: JSON.stringify({ items: [] }) },
    });

    // request payment — the callback MUST point at the public origin the
    // visitor's browser sees (https://domain.tld behind the DirectAdmin proxy),
    // NOT the internal loopback hop the request came through.
    const callbackUrl =
      paymentSettings.callbackUrl ||
      `${getPublicOrigin(req)}/api/payment/callback`;

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
        data: { status: "PAYMENT_FAILED", paymentStatus: "FAILED", paymentError: payResult.message ?? "خطای ایجاد تراکنش" },
      });
      return fail(`خطا در اتصال به درگاه پرداخت: ${payResult.message ?? "نامشخص"}`, 502, { orderId: order.id, orderNumber: order.orderNumber });
    }

    await db.order.update({
      where: { id: order.id },
      data: { paymentAuthority: payResult.authority },
    });

    await logAudit(user.id, "PAYMENT_REQUESTED", {
      entity: "order",
      entityId: order.id,
      detail: { orderNumber: order.orderNumber, total: order.total, simulated: payResult.simulated, coupon: appliedCouponCode },
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
    console.error("payment request error:", e);
    return fail("خطای داخلی در ایجاد پرداخت", 500);
  }
}

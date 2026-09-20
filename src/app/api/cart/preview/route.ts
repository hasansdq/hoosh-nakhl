import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { getSettings, type GeneralSettings } from "@/lib/settings";
import { computePricing } from "@/lib/chat/engine";
import { checkCoupon } from "@/lib/coupons";

// ============ POST /api/cart/preview — سبد خرید: پیش‌نمایش فاکتور (soft validation) ============

interface CartPreviewBody {
  items?: { itemId?: unknown; quantity?: unknown }[];
  deliveryMethod?: unknown;
  couponCode?: unknown;
  address?: unknown;
}

const MAX_QTY_PER_ITEM = 30;

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const body = (await req.json().catch(() => ({}))) as CartPreviewBody;
    const deliveryMethod = body.deliveryMethod === "PICKUP" ? "PICKUP" : "DELIVERY";
    const address = typeof body.address === "string" ? body.address.trim().slice(0, 500) : "";
    const couponCode = typeof body.couponCode === "string" ? body.couponCode.trim().slice(0, 24) : "";

    // ---- normalize incoming items (merge duplicates, clamp qty) ----
    const seen = new Map<string, number>();
    for (const raw of Array.isArray(body.items) ? body.items : []) {
      const itemId = typeof raw?.itemId === "string" ? raw.itemId : null;
      if (!itemId) continue;
      const qty = Math.max(1, Math.min(MAX_QTY_PER_ITEM, Math.floor(Number(raw?.quantity) || 1)));
      seen.set(itemId, Math.min(MAX_QTY_PER_ITEM, (seen.get(itemId) ?? 0) + qty));
    }

    // ---- authoritative validation against DB ----
    const ids = [...seen.keys()];
    const menuItems =
      ids.length > 0 ? await db.menuItem.findMany({ where: { id: { in: ids } } }) : [];

    const items: {
      itemId: string;
      name: string;
      imageUrl: string | null;
      unitPrice: number;
      quantity: number;
      lineTotal: number;
    }[] = [];
    const unavailableItems: { itemId: string; name: string }[] = [];

    for (const [itemId, quantity] of seen) {
      const mi = menuItems.find((m) => m.id === itemId);
      if (!mi || !mi.isAvailable) {
        unavailableItems.push({ itemId, name: mi?.name ?? "آیتم حذف‌شده" });
        continue;
      }
      items.push({
        itemId: mi.id,
        name: mi.name,
        imageUrl: mi.imageUrl,
        unitPrice: mi.price, // authoritative price from DB
        quantity,
        lineTotal: mi.price * quantity,
      });
    }

    const general = await getSettings<GeneralSettings>("general");

    // ---- coupon: SOFT check (invalid coupon never fails the preview) ----
    let couponValid = false;
    let couponReason: string | undefined;
    let appliedCouponCode: string | undefined;
    let couponTitle: string | undefined;
    let couponLabel: string | undefined;
    let discount = 0;

    const rawSubtotal = items.reduce((s, i) => s + i.lineTotal, 0);
    if (couponCode && rawSubtotal > 0) {
      const check = await checkCoupon(couponCode, user.id, rawSubtotal);
      if (check.valid && check.coupon) {
        couponValid = true;
        appliedCouponCode = check.coupon.code;
        couponTitle = check.coupon.title;
        couponLabel = check.label;
        discount = check.discount;
      } else {
        couponReason = check.reason ?? "کد تخفیف قابل اعمال نیست";
      }
    }

    // ---- pricing via shared engine ----
    const pricing = computePricing(
      {
        items: items.map((i) => ({ itemId: i.itemId, name: i.name, price: i.unitPrice, quantity: i.quantity })),
        deliveryMethod,
        address,
        couponCode: appliedCouponCode,
      },
      general,
      discount
    );

    return ok({
      items,
      unavailableItems,
      ...pricing,
      couponValid,
      couponCode: appliedCouponCode,
      couponTitle,
      couponLabel,
      couponReason,
      baseDeliveryFee: general.deliveryFee,
      freeDeliveryOver: general.freeDeliveryOver,
      freeDeliveryEligible: general.freeDeliveryOver > 0 && pricing.subtotal >= general.freeDeliveryOver,
      minOrderAmount: general.minOrderAmount,
      belowMinOrder:
        general.minOrderAmount > 0 && pricing.subtotal > 0 && pricing.subtotal < general.minOrderAmount,
    });
  } catch (e) {
    console.error("cart preview error:", e);
    return fail("خطای داخلی در محاسبه سبد خرید", 500);
  }
}

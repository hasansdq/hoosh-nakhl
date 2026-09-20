import "server-only";
import { db } from "@/lib/db";
import { formatToman } from "@/lib/fa";

// ============ Coupon engine — کد تخفیف ============

export interface CouponCheck {
  valid: boolean;
  reason?: string; // Persian reason when invalid
  coupon?: {
    code: string;
    title: string;
    type: "PERCENT" | "FIXED";
    value: number;
    minOrder: number;
    maxDiscount: number | null;
  };
  discount: number; // computed for given subtotal
  label?: string; // human-readable discount label
}

export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "").replace(/[۰-۹]/g, (d) =>
    String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))
  );
}

/** Compute discount amount for a coupon on a given subtotal */
export function computeDiscount(
  coupon: { type: string; value: number; maxDiscount: number | null },
  subtotal: number
): number {
  let discount = 0;
  if (coupon.type === "PERCENT") {
    discount = Math.round((subtotal * Math.min(100, Math.max(1, coupon.value))) / 100);
    if (coupon.maxDiscount && coupon.maxDiscount > 0) {
      discount = Math.min(discount, coupon.maxDiscount);
    }
  } else {
    discount = Math.max(0, coupon.value);
  }
  return Math.min(discount, subtotal); // never exceed subtotal
}

/** Full validation of a coupon for a user + subtotal */
export async function checkCoupon(
  rawCode: string,
  userId: string,
  subtotal: number
): Promise<CouponCheck> {
  const code = normalizeCouponCode(rawCode);
  if (!code || code.length < 3 || code.length > 24) {
    return { valid: false, reason: "قالب کد تخفیف معتبر نیست", discount: 0 };
  }

  const coupon = await db.coupon.findUnique({ where: { code } });
  if (!coupon) {
    return { valid: false, reason: "چنین کد تخفیفی وجود ندارد 🤔", discount: 0 };
  }
  if (!coupon.isActive) {
    return { valid: false, reason: "این کد تخفیف غیرفعال شده است", discount: 0 };
  }
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) {
    return { valid: false, reason: "زمان استفاده از این کد هنوز نرسیده است", discount: 0 };
  }
  if (coupon.expiresAt && coupon.expiresAt < now) {
    return { valid: false, reason: "مهلت استفاده از این کد تخفیف تمام شده است", discount: 0 };
  }
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, reason: "ظرفیت استفاده از این کد تکمیل شده است", discount: 0 };
  }
  if (subtotal < coupon.minOrder) {
    return {
      valid: false,
      reason: `حداقل مبلغ سفارش برای این کد ${formatToman(coupon.minOrder)} است`,
      discount: 0,
    };
  }

  // per-user usage check (only successful/paid usages count)
  if (coupon.perUserLimit > 0) {
    const usedByUser = await db.order.count({
      where: {
        userId,
        couponCode: coupon.code,
        paymentStatus: "PAID",
      },
    });
    if (usedByUser >= coupon.perUserLimit) {
      return {
        valid: false,
        reason: "شما قبلاً از این کد تخفیف استفاده کرده‌اید",
        discount: 0,
      };
    }
  }

  const discount = computeDiscount(coupon, subtotal);
  if (discount <= 0) {
    return { valid: false, reason: "این کد برای سبد شما تخفیفی ندارد", discount: 0 };
  }

  return {
    valid: true,
    coupon: {
      code: coupon.code,
      title: coupon.title,
      type: coupon.type as "PERCENT" | "FIXED",
      value: coupon.value,
      minOrder: coupon.minOrder,
      maxDiscount: coupon.maxDiscount,
    },
    discount,
    label:
      coupon.type === "PERCENT"
        ? `${coupon.value}٪ تخفیف${coupon.maxDiscount ? ` (حداکثر ${formatToman(coupon.maxDiscount)})` : ""}`
        : `تخفیف ${formatToman(coupon.value)}`,
  };
}

/** Active public coupons (for admin dashboard + hero banner marquee) */
export async function getBestActiveCoupon(): Promise<{
  code: string;
  title: string;
  type: string;
  value: number;
  label: string;
} | null> {
  const now = new Date();
  const coupons = await db.coupon.findMany({
    where: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: [{ type: "desc" }, { value: "desc" }],
  });
  if (coupons.length === 0) return null;
  // prefer percent coupons with higher effective value
  const c = coupons[0];
  return {
    code: c.code,
    title: c.title,
    type: c.type,
    value: c.value,
    label: c.type === "PERCENT" ? `${c.value}٪ تخفیف` : `${formatToman(c.value)} تخفیف`,
  };
}

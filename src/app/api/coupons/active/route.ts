import { db } from "@/lib/db";
import { ok } from "@/lib/api";
import { getBestActiveCoupon } from "@/lib/coupons";

/**
 * Public: active coupon banner info
 */
export async function GET() {
  try {
    const best = await getBestActiveCoupon();
    const activeCount = await db.coupon.count({
      where: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    return ok({ coupon: best, activeCount });
  } catch {
    return ok({ coupon: null, activeCount: 0 });
  }
}

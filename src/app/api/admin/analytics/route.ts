import { db } from "@/lib/db";
import { ok, fail, requireAdmin } from "@/lib/api";
import { toJalali, toPersianDigits, jalaliMonthName } from "@/lib/fa";

// orders created from the classic cart carry this first status-log note
// (see src/app/api/cart/checkout/route.ts) — everything else came from the AI chat
const CART_NOTE = "سفارش از سبد خرید ثبت شد";

const STATUS_ORDER = [
  "PENDING_PAYMENT",
  "PAID",
  "PREPARING",
  "READY",
  "DELIVERING",
  "DELIVERED",
  "CANCELED",
  "PAYMENT_FAILED",
];

/** days param: default 30, allowed 7/30/90, others clamped to the nearest bucket */
function clampDays(raw: string | null): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return 30;
  if (n <= 14) return 7;
  if (n <= 60) return 30;
  return 90;
}

/** "YYYY-MM-DD" from LOCAL date parts (no TZ lib) */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req: Request) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));

    // range = last `days` calendar days, inclusive of today (local timezone)
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));

    const [paidOrders, allOrders, coupons] = await Promise.all([
      db.order.findMany({
        where: { paymentStatus: "PAID", createdAt: { gte: start } },
        select: {
          total: true,
          taxAmount: true,
          discount: true,
          deliveryFee: true,
          couponCode: true,
          createdAt: true,
          items: { select: { name: true, quantity: true, lineTotal: true } },
          statusLogs: { orderBy: { createdAt: "asc" }, take: 1, select: { note: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.order.findMany({
        where: { createdAt: { gte: start } },
        select: { status: true },
      }),
      db.coupon.findMany({ orderBy: { createdAt: "asc" } }),
    ]);

    // ---- KPIs (paid orders only) ----
    const totalRevenue = paidOrders.reduce((s, o) => s + o.total, 0);
    const totalVat = paidOrders.reduce((s, o) => s + o.taxAmount, 0);
    const totalDiscount = paidOrders.reduce((s, o) => s + o.discount, 0);
    const deliveryRevenue = paidOrders.reduce((s, o) => s + o.deliveryFee, 0);
    const totalItemsSold = paidOrders.reduce(
      (s, o) => s + o.items.reduce((x, i) => x + i.quantity, 0),
      0
    );
    const kpis = {
      totalRevenue,
      orderCount: paidOrders.length,
      avgOrderValue: paidOrders.length ? Math.round(totalRevenue / paidOrders.length) : 0,
      totalVat,
      totalDiscount,
      deliveryRevenue,
      totalItemsSold,
    };

    // ---- revenue by day (fill missing days with zeros, local grouping) ----
    const revenueByDay: {
      date: string;
      label: string; // short Jalali day, e.g. «۱۵ مرداد»
      revenue: number;
      orders: number;
      discount: number;
    }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1);
      const dayOrders = paidOrders.filter((o) => o.createdAt >= dayStart && o.createdAt < dayEnd);
      const j = toJalali(dayStart);
      revenueByDay.push({
        date: localDateKey(dayStart),
        label: `${toPersianDigits(j.jd)} ${jalaliMonthName(j.jm)}`,
        revenue: dayOrders.reduce((s, o) => s + o.total, 0),
        orders: dayOrders.length,
        discount: dayOrders.reduce((s, o) => s + o.discount, 0),
      });
    }

    // ---- top items (top 8 by quantity) ----
    const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const o of paidOrders) {
      for (const it of o.items) {
        const cur = itemMap.get(it.name) ?? { name: it.name, qty: 0, revenue: 0 };
        cur.qty += it.quantity;
        cur.revenue += it.lineTotal;
        itemMap.set(it.name, cur);
      }
    }
    const topItems = [...itemMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 8);

    // ---- coupon impact (every coupon, even unused ones) ----
    const couponImpact = coupons.map((c) => {
      const inRange = paidOrders.filter((o) => o.couponCode === c.code);
      return {
        code: c.code,
        title: c.title,
        type: c.type, // PERCENT | FIXED
        value: c.value,
        usedCount: c.usedCount, // global usage counter
        ordersInRange: inRange.length,
        discountGiven: inRange.reduce((s, o) => s + o.discount, 0),
        revenue: inRange.reduce((s, o) => s + o.total, 0),
      };
    });

    // ---- channel split (chat vs cart) — first statusLog note tells the origin ----
    let chatOrders = 0;
    let chatRevenue = 0;
    let cartOrders = 0;
    let cartRevenue = 0;
    for (const o of paidOrders) {
      if (o.statusLogs[0]?.note === CART_NOTE) {
        cartOrders++;
        cartRevenue += o.total;
      } else {
        chatOrders++;
        chatRevenue += o.total;
      }
    }
    const channelSplit = [
      { channel: "CHAT", orders: chatOrders, revenue: chatRevenue },
      { channel: "CART", orders: cartOrders, revenue: cartRevenue },
    ];

    // ---- status split (ALL orders in range, any payment status) ----
    const statusMap = new Map<string, number>();
    for (const o of allOrders) statusMap.set(o.status, (statusMap.get(o.status) ?? 0) + 1);
    const statusSplit = STATUS_ORDER.filter((s) => statusMap.has(s)).map((s) => ({
      status: s,
      count: statusMap.get(s) ?? 0,
    }));

    return ok({
      days,
      kpis,
      revenueByDay,
      topItems,
      couponImpact,
      channelSplit,
      statusSplit,
    });
  } catch (e) {
    console.error("analytics error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

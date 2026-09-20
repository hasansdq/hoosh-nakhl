import { db } from "@/lib/db";
import { ok, fail, requireAdmin } from "@/lib/api";
import { toJalali } from "@/lib/fa";

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

    const [
      totalOrders,
      paidOrders,
      pendingOrders,
      totalUsers,
      newUsersWeek,
      revenueMonthAgg,
      revenueTodayAgg,
      recentOrders,
      topItems,
      ordersByDay,
      statusCounts,
      newPaidOrders,
      pendingReviews,
      activeCoupons,
    ] = await Promise.all([
      db.order.count(),
      db.order.count({ where: { paymentStatus: "PAID" } }),
      db.order.count({ where: { status: "PENDING_PAYMENT" } }),
      db.user.count(),
      db.user.count({ where: { createdAt: { gte: weekAgo } } }),
      db.order.aggregate({ where: { paymentStatus: "PAID", createdAt: { gte: monthAgo } }, _sum: { total: true } }),
      db.order.aggregate({ where: { paymentStatus: "PAID", createdAt: { gte: todayStart } }, _sum: { total: true } }),
      db.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { user: { select: { firstName: true, lastName: true, phone: true } } },
      }),
      db.orderItem.groupBy({
        by: ["name"],
        where: { order: { paymentStatus: "PAID" } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 6,
      }),
      db.order.findMany({
        where: { createdAt: { gte: monthAgo } },
        select: { createdAt: true, total: true, paymentStatus: true },
      }),
      db.order.groupBy({ by: ["status"], _count: true }),
      // new paid orders since 15 min ago — for the live notification badge
      db.order.count({
        where: { paymentStatus: "PAID", createdAt: { gte: new Date(now.getTime() - 15 * 60 * 1000) } },
      }),
      db.review.count({ where: { status: "PENDING" } }),
      db.coupon.count({ where: { isActive: true } }),
    ]);

    // revenue chart (last 14 days)
    const days: { date: string; total: number; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 3600 * 1000);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
      const dayOrders = ordersByDay.filter(
        (o) => o.createdAt >= dayStart && o.createdAt < dayEnd && o.paymentStatus === "PAID"
      );
      const j = toJalali(dayStart);
      days.push({
        date: `${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`,
        total: dayOrders.reduce((s, o) => s + o.total, 0),
        count: dayOrders.length,
      });
    }

    return ok({
      stats: {
        totalOrders,
        paidOrders,
        pendingOrders,
        totalUsers,
        newUsersWeek,
        revenueMonth: revenueMonthAgg._sum.total ?? 0,
        revenueToday: revenueTodayAgg._sum.total ?? 0,
        newPaidOrders,
        pendingReviews,
        activeCoupons,
      },
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: o.total,
        type: o.type,
        createdAt: o.createdAt.toISOString(),
        customer: o.user ? `${o.user.firstName ?? ""} ${o.user.lastName ?? ""}`.trim() || o.user.phone : "-",
      })),
      topItems: topItems.map((t) => ({ name: t.name, quantity: t._sum.quantity ?? 0 })),
      revenueChart: days,
      statusCounts: statusCounts.map((s) => ({ status: s.status, count: s._count })),
    });
  } catch (e) {
    console.error("stats error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

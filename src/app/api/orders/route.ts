import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { ORDER_STATUS_LABELS } from "@/lib/chat/engine";

export async function GET() {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const [orders, myReviews] = await Promise.all([
      db.order.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { items: true },
      }),
      db.review.findMany({
        where: { userId: user.id },
        select: { menuItemId: true, rating: true },
      }),
    ]);

    const reviewedMap = new Map(myReviews.map((r) => [r.menuItemId, r.rating]));

    return ok({
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        statusLabel: ORDER_STATUS_LABELS[o.status] ?? o.status,
        paymentStatus: o.paymentStatus,
        paymentRef: o.paymentRef,
        paymentError: o.paymentError,
        type: o.type,
        address: o.address,
        subtotal: o.subtotal,
        deliveryFee: o.deliveryFee,
        discount: o.discount,
        couponCode: o.couponCode,
        taxAmount: o.taxAmount,
        total: o.total,
        createdAt: o.createdAt.toISOString(),
        scheduledFor: o.scheduledFor ? o.scheduledFor.toISOString() : null,
        items: o.items.map((i) => ({
          menuItemId: i.menuItemId,
          name: i.name,
          quantity: i.quantity,
          lineTotal: i.lineTotal,
          myRating: i.menuItemId ? reviewedMap.get(i.menuItemId) ?? null : null,
        })),
        canReview: o.status === "DELIVERED",
      })),
    });
  } catch (e) {
    console.error("orders error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

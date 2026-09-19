import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";

/** GET ?order=NK-XXXX — payment status for post-gateway display */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const orderNumber = new URL(req.url).searchParams.get("order");
    if (!orderNumber) return fail("شماره سفارش لازم است");

    const order = await db.order.findFirst({
      where: { orderNumber, userId: user.id },
      include: { items: true },
    });
    if (!order) return fail("سفارش یافت نشد", 404);

    return ok({
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentRef: order.paymentRef,
        paymentError: order.paymentError,
        total: order.total,
        type: order.type,
        address: order.address,
        createdAt: order.createdAt.toISOString(),
        items: order.items.map((i) => ({ name: i.name, quantity: i.quantity, lineTotal: i.lineTotal })),
      },
    });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

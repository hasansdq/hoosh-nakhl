import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin } from "@/lib/api";
import { toEnglishDigits } from "@/lib/fa";
import { ORDER_STATUS_LABELS } from "@/lib/chat/engine";

const VALID_STATUSES = ["PENDING_PAYMENT", "PAID", "PREPARING", "READY", "DELIVERING", "DELIVERED", "CANCELED", "PAYMENT_FAILED"];

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const search = url.searchParams.get("q");
    const pageValue = Number(url.searchParams.get("page") ?? 1);
    const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
    const pageSize = 15;

    // search also matches the customer phone snapshot (exact digits) so an
    // admin can find an order by the phone number printed on the invoice
    const digits = toEnglishDigits(search ?? "").replace(/\D/g, "").replace(/^(?:0098|98|0)(?=9)/, "");
    const where = {
      ...(status && VALID_STATUSES.includes(status) ? { status } : {}),
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: search } },
              ...(digits ? [
                { customerPhone: { contains: digits } },
                { customerPhone: { contains: `98${digits}` } },
                { user: { phone: { contains: digits } } },
                { user: { phone: { contains: `98${digits}` } } },
              ] : []),
              { user: { firstName: { contains: search } } },
              { user: { lastName: { contains: search } } },
            ],
          }
        : {}),
    };

    const [orders, total] = await Promise.all([
      db.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          items: true,
          user: { select: { firstName: true, lastName: true, phone: true } },
        },
      }),
      db.order.count({ where }),
    ]);

    return ok({
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        statusLabel: ORDER_STATUS_LABELS[o.status] ?? o.status,
        paymentStatus: o.paymentStatus,
        paymentRef: o.paymentRef,
        paymentAuthority: o.paymentAuthority,
        paymentError: o.paymentError,
        type: o.type,
        address: o.address,
        note: o.note,
        subtotal: o.subtotal,
        deliveryFee: o.deliveryFee,
        taxAmount: o.taxAmount,
        discount: o.discount,
        couponCode: o.couponCode,
        total: o.total,
        createdAt: o.createdAt.toISOString(),
        paidAt: o.paidAt?.toISOString() ?? null,
        customer: o.customerName || (o.user ? `${o.user.firstName ?? ""} ${o.user.lastName ?? ""}`.trim() : "") || o.customerPhone || o.user?.phone || "-",
        customerPhone: o.customerPhone ?? o.user?.phone ?? "-",
        baranFactorNumber: o.baranFactorNumber,
        baranSentAt: o.baranSentAt?.toISOString() ?? null,
        items: o.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, lineTotal: i.lineTotal })),
      })),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    });
  } catch (e) {
    console.error("admin orders error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

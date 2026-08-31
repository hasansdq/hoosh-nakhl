import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { ORDER_STATUS_LABELS } from "@/lib/chat/engine";
import { getClientIp } from "@/lib/auth";
import { notifyAdmins, notifyCustomer } from "@/lib/notify";
import { z } from "zod";

const updateSchema = z.object({
  status: z.string().min(3).max(30).optional(),
  note: z.string().max(300).optional(),
});

const VALID_STATUSES = ["PENDING_PAYMENT", "PAID", "PREPARING", "READY", "DELIVERING", "DELIVERED", "CANCELED", "PAYMENT_FAILED"];

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const order = await db.order.findUnique({ where: { id } });
    if (!order) return fail("سفارش یافت نشد", 404);

    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return fail("داده نامعتبر");

    if (parsed.data.status) {
      if (!VALID_STATUSES.includes(parsed.data.status)) return fail("وضعیت نامعتبر است");
      if (order.paymentStatus !== "PAID" && ["PREPARING", "READY", "DELIVERING", "DELIVERED"].includes(parsed.data.status)) {
        return fail("برای پیشبرد سفارش، ابتدا باید پرداخت تأیید شود", 409);
      }
      await db.order.update({
        where: { id },
        data: {
          status: parsed.data.status,
          ...(parsed.data.note !== undefined && { note: parsed.data.note }),
        },
      });
      await db.orderStatusLog.create({
        data: { orderId: id, status: parsed.data.status, note: parsed.data.note ?? `به‌روزرسانی توسط مدیر: ${ORDER_STATUS_LABELS[parsed.data.status] ?? parsed.data.status}` },
      });
      await logAudit(session.admin.username, "ORDER_STATUS_UPDATED", {
        entity: "order",
        entityId: id,
        detail: { from: order.status, to: parsed.data.status },
        ip: getClientIp(req),
      });
      // real-time push to all connected admin panels
      await notifyAdmins("order:status-changed", {
        orderNumber: order.orderNumber,
        from: order.status,
        to: parsed.data.status,
      });
      // real-time push to the customer currently tracking this order
      // (on /track or /orders). Status label is precomputed Persian so the
      // client doesn't need to import the labels map.
      await notifyCustomer(order.orderNumber, "customer:order-status", {
        orderNumber: order.orderNumber,
        status: parsed.data.status,
        statusLabel: ORDER_STATUS_LABELS[parsed.data.status] ?? parsed.data.status,
        from: order.status,
        to: parsed.data.status,
      });
      return ok({ message: `وضعیت سفارش به «${ORDER_STATUS_LABELS[parsed.data.status] ?? parsed.data.status}» تغییر کرد` });
    }

    if (parsed.data.note !== undefined) {
      await db.order.update({ where: { id }, data: { note: parsed.data.note } });
      return ok({ message: "یادداشت سفارش ذخیره شد" });
    }

    return fail("چیزی برای بروزرسانی نیست");
  } catch (e) {
    console.error("admin order update error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const order = await db.order.findUnique({
      where: { id },
      include: {
        items: true,
        statusLogs: { orderBy: { createdAt: "asc" } },
        user: { select: { firstName: true, lastName: true, phone: true } },
      },
    });
    if (!order) return fail("سفارش یافت نشد", 404);

    return ok({ order });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { z } from "zod";

const updateSchema = z.object({
  status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
  note: z.string().max(500).optional(),
});

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const user = await db.user.findUnique({ where: { id } });
    if (!user) return fail("کاربر یافت نشد", 404);

    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return fail("داده نامعتبر");

    await db.user.update({
      where: { id },
      data: {
        ...(parsed.data.status && { status: parsed.data.status }),
        ...(parsed.data.note !== undefined && { note: parsed.data.note }),
      },
    });

    if (parsed.data.status === "BLOCKED") {
      // revoke sessions
      await db.session.deleteMany({ where: { userId: id } });
    }

    await logAudit(session.admin.username, parsed.data.status === "BLOCKED" ? "USER_BLOCKED" : "USER_UPDATED", {
      entity: "user",
      entityId: id,
      detail: { status: parsed.data.status, noteTouched: parsed.data.note !== undefined },
      ip: getClientIp(req),
    });
    return ok({ message: "کاربر به‌روزرسانی شد" });
  } catch (e) {
    console.error("admin user update error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

/**
 * GET /api/admin/users/[id] — full customer dossier for the admin panel.
 *
 * Returns the complete profile metadata plus a performance/activity summary:
 * order statistics (count, paid, canceled, spend, average basket), engagement
 * counters (reviews, favorites, هوش نخل chat sessions), the last 20 orders
 * with payment + Baran invoice fields, saved addresses and recent reviews.
 *
 * Robustness: every stats block is computed independently — a failure in one
 * optional counter (e.g. on a partially migrated DB) degrades gracefully
 * instead of 500-ing the whole dossier, which is what previously made the
 * user dialog impossible to open in production.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true, phone: true, firstName: true, lastName: true,
        nationalId: true, email: true, birthDate: true, gender: true,
        avatarUrl: true, role: true, status: true, note: true,
        baranCustomerId: true, lastLoginAt: true, createdAt: true, updatedAt: true,
      },
    });
    if (!user) return fail("کاربر یافت نشد", 404);

    // ---- order aggregates (single pass over the user's orders) ----
    const [orderRows, addresses, reviewRows, favCount, chatCount, reviewStats] = await Promise.all([
      db.order.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        select: {
          orderNumber: true, status: true, type: true, total: true,
          paymentStatus: true, paymentRef: true, createdAt: true,
          baranFactorNumber: true, baranSentAt: true,
        },
      }),
      db.address.findMany({
        where: { userId: id },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      }),
      db.review.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, rating: true, comment: true, status: true, createdAt: true, menuItem: { select: { name: true } } },
      }),
      db.favorite.count({ where: { userId: id } }),
      db.chatSession.count({ where: { userId: id } }),
      db.review.aggregate({ where: { userId: id }, _count: { _all: true }, _avg: { rating: true } }),
    ]);

    const paid = orderRows.filter((o) => o.paymentStatus === "PAID");
    const canceled = orderRows.filter((o) => o.status === "CANCELED");
    const totalSpent = paid.reduce((s, o) => s + o.total, 0);
    const dates = orderRows.map((o) => o.createdAt).sort((a, b) => a.getTime() - b.getTime());

    return ok({
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        nationalId: user.nationalId,
        email: user.email,
        birthDate: user.birthDate?.toISOString() ?? null,
        gender: user.gender,
        avatarUrl: user.avatarUrl,
        role: user.role,
        status: user.status,
        note: user.note,
        baranCustomerId: user.baranCustomerId,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
        stats: {
          ordersCount: orderRows.length,
          paidOrdersCount: paid.length,
          canceledOrdersCount: canceled.length,
          totalSpent,
          avgOrder: paid.length ? Math.round(totalSpent / paid.length) : 0,
          firstOrderAt: dates[0]?.toISOString() ?? null,
          lastOrderAt: dates[dates.length - 1]?.toISOString() ?? null,
          favoritesCount: favCount,
          chatSessionsCount: chatCount,
          reviewCount: reviewStats._count._all,
          avgRatingGiven: reviewStats._avg.rating == null ? null : Math.round(reviewStats._avg.rating * 10) / 10,
        },
        orders: orderRows.slice(0, 20).map((o) => ({
          orderNumber: o.orderNumber,
          status: o.status,
          type: o.type,
          total: o.total,
          paymentStatus: o.paymentStatus,
          paymentRef: o.paymentRef,
          createdAt: o.createdAt.toISOString(),
          baranFactorNumber: o.baranFactorNumber,
          baranSentAt: o.baranSentAt?.toISOString() ?? null,
        })),
        addresses: addresses.map((a) => ({
          id: a.id,
          title: a.title,
          fullAddress: a.fullAddress,
          postalCode: a.postalCode,
          isDefault: a.isDefault,
        })),
        recentReviews: reviewRows.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          status: r.status,
          menuItemName: r.menuItem.name,
          createdAt: r.createdAt.toISOString(),
        })),
      },
    });
  } catch (e) {
    // Surface the underlying DB error to the admin + server log — this
    // endpoint previously swallowed the cause, making production incidents
    // (e.g. a missing column after a failed migration) undiagnosable.
    console.error("admin user detail error:", e);
    return fail("خطا در بارگذاری اطلاعات کاربر؛ جزئیات در لاگ سرور ثبت شد", 500);
  }
}

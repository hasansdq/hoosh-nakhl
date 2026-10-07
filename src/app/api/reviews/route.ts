import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { rateLimit } from "@/lib/auth";
import { notifyAdmins } from "@/lib/notify";
import { z } from "zod";

const reviewSchema = z.object({
  menuItemId: z.string().min(5),
  orderId: z.string().optional(),
  rating: z.number().int().min(1, "امتیاز را انتخاب کنید").max(5),
  comment: z.string().trim().max(600, "متن نظر حداکثر ۶۰۰ نویسه").optional().or(z.literal("")),
});

/** Public approved reviews for a menu item */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const menuItemId = url.searchParams.get("menuItemId");
    const query: { status: string } = { status: "APPROVED" };
    const where = menuItemId ? { ...query, menuItemId } : query;

    const reviews = await db.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        user: { select: { firstName: true, lastName: true } },
        menuItem: { select: { name: true } },
      },
    });

    // eligibility info for the review form (only when logged in + item targeted)
    let canReview = false;
    let hasReviewed = false;
    if (menuItemId) {
      const user = await requireUser().catch(() => null);
      if (user) {
        const existing = await db.review.findUnique({
          where: { userId_menuItemId: { userId: user.id, menuItemId } },
        });
        hasReviewed = !!existing;
        const deliveredOrder = await db.order.findFirst({
          where: {
            userId: user.id,
            status: "DELIVERED",
            items: { some: { menuItemId } },
          },
        });
        canReview = !!deliveredOrder;
      }
    }

    return ok({
      canReview,
      hasReviewed,
      reviews: reviews.map((r) => ({
        id: r.id,
        menuItemName: r.menuItem.name,
        authorName: `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || "مهمان نخل",
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

/** Submit a review — user must have a DELIVERED order containing the item */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const rl = rateLimit(`review:${user.id}`, 10, 60 * 60 * 1000); // 10/hour
    if (!rl.ok) return fail("تعداد نظرات زیاد است؛ کمی بعد دوباره تلاش کنید", 429);

    const body = await req.json().catch(() => ({}));
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");

    const { menuItemId, orderId, rating, comment } = parsed.data;

    const item = await db.menuItem.findUnique({ where: { id: menuItemId } });
    if (!item) return fail("این غذا در منو موجود نیست", 404);

    // must own a delivered order that included this item
    const deliveredOrder = await db.order.findFirst({
      where: {
        userId: user.id,
        status: "DELIVERED",
        ...(orderId ? { id: orderId } : {}),
        items: { some: { menuItemId } },
      },
    });
    if (!deliveredOrder) {
      return fail("فقط بعد از تحویل سفارش می‌توانید برای غذاهای آن امتیاز ثبت کنید");
    }

    const existing = await db.review.findUnique({
      where: { userId_menuItemId: { userId: user.id, menuItemId } },
    });
    if (existing) {
      const updated = await db.review.update({
        where: { id: existing.id },
        data: {
          rating,
          comment: comment || null,
          status: "PENDING", // re-moderate on edit
          orderId: deliveredOrder.id,
        },
      });
      await notifyAdmins("review:new-pending", {
        id: updated.id,
        itemName: item.name,
        userName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.phone,
        rating,
      });
      return ok({ review: { id: updated.id, rating: updated.rating }, updated: true });
    }

    const review = await db.review.create({
      data: {
        userId: user.id,
        menuItemId,
        orderId: deliveredOrder.id,
        rating,
        comment: comment || null,
        status: "PENDING",
      },
    });
    await notifyAdmins("review:new-pending", {
      id: review.id,
      itemName: item.name,
      userName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.phone,
      rating,
    });
    return ok({ review: { id: review.id, rating: review.rating } });
  } catch (e) {
    console.error("review error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

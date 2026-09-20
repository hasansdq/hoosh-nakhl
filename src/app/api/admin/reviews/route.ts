import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const url = new URL(req.url);
    const status = url.searchParams.get("status"); // PENDING | APPROVED | REJECTED | all

    const reviews = await db.review.findMany({
      where: status && status !== "all" ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        user: { select: { firstName: true, lastName: true, phone: true } },
        menuItem: { select: { name: true, imageUrl: true } },
      },
    });

    const [pending, approved, rejected] = await Promise.all([
      db.review.count({ where: { status: "PENDING" } }),
      db.review.count({ where: { status: "APPROVED" } }),
      db.review.count({ where: { status: "REJECTED" } }),
    ]);

    return ok({
      reviews: reviews.map((r) => ({
        id: r.id,
        authorName: `${r.user.firstName ?? ""} ${r.user.lastName ?? ""}`.trim() || "مهمان",
        authorPhone: r.user.phone,
        menuItemName: r.menuItem.name,
        menuItemImage: r.menuItem.imageUrl,
        rating: r.rating,
        comment: r.comment,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      counts: { pending, approved, rejected },
    });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

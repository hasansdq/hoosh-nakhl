import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { z } from "zod";

const patchSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "PENDING"]),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const review = await db.review.findUnique({ where: { id } });
    if (!review) return fail("نظر یافت نشد", 404);

    const body = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return fail("وضعیت نامعتبر است");

    const updated = await db.review.update({
      where: { id },
      data: { status: parsed.data.status },
    });

    await logAudit(session.admin.username, `REVIEW_${parsed.data.status}`, {
      entity: "review",
      entityId: id,
      detail: { menuItemId: review.menuItemId, rating: review.rating },
      ip: getClientIp(req),
    });

    return ok({ review: { id: updated.id, status: updated.status } });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const review = await db.review.findUnique({ where: { id } });
    if (!review) return fail("نظر یافت نشد", 404);

    await db.review.delete({ where: { id } });
    await logAudit(session.admin.username, "REVIEW_DELETED", {
      entity: "review",
      entityId: id,
      ip: getClientIp(req),
    });
    return ok({ deleted: true });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

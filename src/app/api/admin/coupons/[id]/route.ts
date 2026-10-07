import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { normalizeCouponCode } from "@/lib/coupons";
import { z } from "zod";

const updateSchema = z.object({
  title: z.string().trim().min(2).max(80).optional(),
  type: z.enum(["PERCENT", "FIXED"]).optional(),
  value: z.number().int().min(1).optional(),
  minOrder: z.number().int().min(0).max(500_000_000).optional(),
  maxDiscount: z.number().int().min(0).max(500_000_000).optional().nullable(),
  usageLimit: z.number().int().min(0).max(100000).optional(),
  perUserLimit: z.number().int().min(0).max(1000).optional(),
  startsAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const coupon = await db.coupon.findUnique({ where: { id } });
    if (!coupon) return fail("کد تخفیف یافت نشد", 404);

    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");

    const data = parsed.data;
    if (data.type === "PERCENT" && (data.value ?? 0) > 100) {
      return fail("درصد تخفیف نمی‌تواند بیش از ۱۰۰ باشد");
    }

    const updated = await db.coupon.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.value !== undefined ? { value: data.value } : {}),
        ...(data.minOrder !== undefined ? { minOrder: data.minOrder } : {}),
        ...(data.maxDiscount !== undefined
          ? { maxDiscount: data.maxDiscount && data.maxDiscount > 0 ? data.maxDiscount : null }
          : {}),
        ...(data.usageLimit !== undefined ? { usageLimit: data.usageLimit } : {}),
        ...(data.perUserLimit !== undefined ? { perUserLimit: data.perUserLimit } : {}),
        ...(data.startsAt !== undefined ? { startsAt: parseDate(data.startsAt) } : {}),
        ...(data.expiresAt !== undefined ? { expiresAt: parseDate(data.expiresAt) } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });

    await logAudit(session.admin.username, "COUPON_UPDATED", {
      entity: "coupon",
      entityId: id,
      detail: { code: updated.code },
      ip: getClientIp(req),
    });
    return ok({ coupon: updated });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const coupon = await db.coupon.findUnique({ where: { id } });
    if (!coupon) return fail("کد تخفیف یافت نشد", 404);

    const ordersUsing = await db.order.count({ where: { couponCode: coupon.code } });
    if (ordersUsing > 0) {
      // keep history: just deactivate
      await db.coupon.update({ where: { id }, data: { isActive: false } });
      await logAudit(session.admin.username, "COUPON_DEACTIVATED", {
        entity: "coupon",
        entityId: id,
        detail: { code: coupon.code, ordersUsing },
        ip: getClientIp(req),
      });
      return ok({ deactivated: true, reason: "به‌دلیل سابقه سفارش‌ها، کد غیرفعال شد (حذف نشد)" });
    }

    await db.coupon.delete({ where: { id } });
    await logAudit(session.admin.username, "COUPON_DELETED", {
      entity: "coupon",
      entityId: id,
      detail: { code: coupon.code },
      ip: getClientIp(req),
    });
    return ok({ deleted: true });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

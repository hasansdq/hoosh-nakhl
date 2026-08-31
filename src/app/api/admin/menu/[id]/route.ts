import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { menuItemSchema } from "@/lib/validators";
import { getClientIp } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const existing = await db.menuItem.findUnique({ where: { id } });
    if (!existing) return fail("آیتم یافت نشد", 404);

    const body = await req.json().catch(() => ({}));
    const parsed = menuItemSchema.partial().safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");
    const d = parsed.data;

    if (d.categoryId) {
      const cat = await db.category.findUnique({ where: { id: d.categoryId } });
      if (!cat) return fail("دسته‌بندی یافت نشد");
    }

    const item = await db.menuItem.update({
      where: { id },
      data: {
        ...(d.name !== undefined && { name: d.name }),
        ...(d.description !== undefined && { description: d.description || null }),
        ...(d.price !== undefined && { price: d.price }),
        ...(d.categoryId !== undefined && { categoryId: d.categoryId }),
        ...(d.imageUrl !== undefined && { imageUrl: d.imageUrl || null }),
        ...(d.gallery !== undefined && {
          gallery:
            Array.isArray(d.gallery) && d.gallery.length > 0
              ? (d.gallery as unknown as Prisma.JsonValue)
              : null,
        }),
        ...(d.isAvailable !== undefined && { isAvailable: d.isAvailable }),
        ...(d.isSpecial !== undefined && { isSpecial: d.isSpecial }),
        ...(d.isDrink !== undefined && { isDrink: d.isDrink }),
        ...(d.isVegetarian !== undefined && { isVegetarian: d.isVegetarian }),
        ...(d.isSpicy !== undefined && { isSpicy: d.isSpicy }),
        ...(d.calories !== undefined && { calories: d.calories ?? null }),
        ...(d.prepTime !== undefined && { prepTime: d.prepTime ?? null }),
        ...(d.ingredients !== undefined && { ingredients: d.ingredients || null }),
        ...(d.sortOrder !== undefined && { sortOrder: d.sortOrder }),
      },
    });

    await logAudit(session.admin.username, "MENU_ITEM_UPDATED", {
      entity: "menuItem",
      entityId: id,
      detail: { changes: Object.keys(d) },
      ip: getClientIp(req),
    });
    return ok({ item });
  } catch (e) {
    console.error("admin menu PUT error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const existing = await db.menuItem.findUnique({ where: { id } });
    if (!existing) return fail("آیتم یافت نشد", 404);

    await db.menuItem.delete({ where: { id } });
    await logAudit(session.admin.username, "MENU_ITEM_DELETED", {
      entity: "menuItem",
      entityId: id,
      detail: { name: existing.name },
      ip: getClientIp(req),
    });
    return ok({ message: "آیتم حذف شد" });
  } catch (e) {
    console.error("admin menu DELETE error:", e);
    return fail("حذف ممکن نیست — این آیتم در سفارش‌ها استفاده شده است", 409);
  }
}

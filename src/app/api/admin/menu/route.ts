import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { menuItemSchema } from "@/lib/validators";
import { getClientIp } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const items = await db.menuItem.findMany({
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { createdAt: "asc" }],
      include: { category: { select: { id: true, name: true } } },
    });

    return ok({
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        price: i.price,
        categoryId: i.categoryId,
        categoryName: i.category.name,
        imageUrl: i.imageUrl,
        gallery: Array.isArray(i.gallery) ? (i.gallery as string[]) : [],
        isAvailable: i.isAvailable,
        isSpecial: i.isSpecial,
        isDrink: i.isDrink,
        isVegetarian: i.isVegetarian,
        isSpicy: i.isSpicy,
        calories: i.calories,
        prepTime: i.prepTime,
        ingredients: i.ingredients,
        sortOrder: i.sortOrder,
        orderCount: i.orderCount,
        createdAt: i.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    console.error("admin menu GET error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const body = await req.json().catch(() => ({}));
    const parsed = menuItemSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");
    const d = parsed.data;

    const category = await db.category.findUnique({ where: { id: d.categoryId } });
    if (!category) return fail("دسته‌بندی یافت نشد");

    const gallery =
      d.gallery && Array.isArray(d.gallery) && d.gallery.length > 0
        ? d.gallery
        : null;

    const item = await db.menuItem.create({
      data: {
        name: d.name,
        description: d.description || null,
        price: d.price,
        categoryId: d.categoryId,
        imageUrl: d.imageUrl || null,
        gallery: gallery as unknown as Prisma.JsonValue | undefined,
        isAvailable: d.isAvailable ?? true,
        isSpecial: d.isSpecial ?? false,
        isDrink: d.isDrink ?? category.slug === "drinks",
        isVegetarian: d.isVegetarian ?? false,
        isSpicy: d.isSpicy ?? false,
        calories: d.calories ?? null,
        prepTime: d.prepTime ?? null,
        ingredients: d.ingredients || null,
        sortOrder: d.sortOrder ?? 0,
      },
    });

    await logAudit(session.admin.username, "MENU_ITEM_CREATED", {
      entity: "menuItem",
      entityId: item.id,
      detail: { name: item.name, price: item.price },
      ip: getClientIp(req),
    });
    return ok({ item });
  } catch (e) {
    console.error("admin menu POST error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

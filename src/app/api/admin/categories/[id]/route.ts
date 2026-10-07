import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { categorySchema } from "@/lib/validators";
import { getClientIp } from "@/lib/auth";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) return fail("دسته یافت نشد", 404);

    const body = await req.json().catch(() => ({}));
    const parsed = categorySchema.partial().safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");

    // تغییر نام دستهٔ متصل به باران مجاز است، اما همگام‌سازی بعدی باران
    // (ProductSEND) نام را به نام گروه باران برمی‌گرداند — در UI هشدار داده می‌شود.
    const category = await db.category.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.icon !== undefined && { icon: parsed.data.icon || null }),
        ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
        ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
        ...(parsed.data.dinnerOnly !== undefined && { dinnerOnly: parsed.data.dinnerOnly }),
      },
    });

    await logAudit(session.admin.username, "CATEGORY_UPDATED", {
      entity: "category",
      entityId: id,
      detail: {
        before: { name: existing.name, icon: existing.icon, sortOrder: existing.sortOrder, isActive: existing.isActive, dinnerOnly: existing.dinnerOnly },
        after: { name: category.name, icon: category.icon, sortOrder: category.sortOrder, isActive: category.isActive, dinnerOnly: category.dinnerOnly },
      },
      ip: getClientIp(req),
    });
    return ok({ category });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const existing = await db.category.findUnique({
      where: { id },
      include: { _count: { select: { items: true } } },
    });
    if (!existing) return fail("دسته یافت نشد", 404);

    const itemCount = existing._count.items;

    // ---- آیتم‌ها باید جایی بروند: یا منتقل شوند به دستهٔ مقصد یا حذف مسدود می‌شود ----
    let targetName: string | null = null;
    if (itemCount > 0) {
      const body = await req.json().catch(() => ({}));
      const moveItemsTo = typeof body?.moveItemsTo === "string" ? body.moveItemsTo : null;

      if (!moveItemsTo || moveItemsTo === id) {
        return fail(
          `این دسته ${itemCount} آیتم دارد؛ دستهٔ مقصدی برای انتقال آیتم‌ها انتخاب کنید`,
          409,
          { itemsCount: itemCount }
        );
      }
      const target = await db.category.findUnique({ where: { id: moveItemsTo } });
      if (!target) return fail("دستهٔ مقصد یافت نشد", 404);
      targetName = target.name;

      await db.menuItem.updateMany({
        where: { categoryId: id },
        data: { categoryId: moveItemsTo },
      });
    }

    await db.category.delete({ where: { id } });

    await logAudit(session.admin.username, "CATEGORY_DELETED", {
      entity: "category",
      entityId: id,
      detail: {
        name: existing.name,
        baranGroupId: existing.baranGroupId,
        movedItems: itemCount > 0 ? { to: targetName, count: itemCount } : null,
      },
      ip: getClientIp(req),
    });

    return ok({
      message:
        itemCount > 0 && targetName
          ? `دسته «${existing.name}» حذف شد و ${itemCount} آیتم به «${targetName}» منتقل شد`
          : "دسته حذف شد",
    });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

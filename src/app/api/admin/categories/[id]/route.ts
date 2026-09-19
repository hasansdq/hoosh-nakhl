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

    const category = await db.category.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.icon !== undefined && { icon: parsed.data.icon || null }),
        ...(parsed.data.sortOrder !== undefined && { sortOrder: parsed.data.sortOrder }),
        ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
      },
    });

    await logAudit(session.admin.username, "CATEGORY_UPDATED", {
      entity: "category",
      entityId: id,
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
    const existing = await db.category.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
    if (!existing) return fail("دسته یافت نشد", 404);
    if (existing._count.items > 0) {
      return fail(`این دسته ${existing._count.items} آیتم دارد؛ ابتدا آیتم‌ها را منتقل یا حذف کنید`, 409);
    }

    await db.category.delete({ where: { id } });
    await logAudit(session.admin.username, "CATEGORY_DELETED", { entity: "category", entityId: id, ip: getClientIp(req) });
    return ok({ message: "دسته حذف شد" });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

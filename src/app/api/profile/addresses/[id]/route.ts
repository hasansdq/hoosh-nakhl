import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";

/** DELETE — remove an address; PUT — set default */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const { id } = await ctx.params;
    const address = await db.address.findFirst({ where: { id, userId: user.id } });
    if (!address) return fail("آدرس یافت نشد", 404);

    await db.address.delete({ where: { id } });
    return ok({ message: "آدرس حذف شد" });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function PUT(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const { id } = await ctx.params;
    const address = await db.address.findFirst({ where: { id, userId: user.id } });
    if (!address) return fail("آدرس یافت نشد", 404);

    await db.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    await db.address.update({ where: { id }, data: { isDefault: true } });
    return ok({ message: "آدرس پیش‌فرض ذخیره شد" });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

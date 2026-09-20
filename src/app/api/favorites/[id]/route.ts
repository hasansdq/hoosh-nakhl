import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";

/** DELETE /api/favorites/:id — remove a favorite by its id (ownership-checked) */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    if (!user) return fail("برای ذخیره علاقه‌مندی‌ها ابتدا وارد شوید", 401);

    const { id } = await ctx.params;
    const fav = await db.favorite.findFirst({
      where: { id, userId: user.id },
      select: { id: true, userId: true },
    });
    if (!fav) return fail("این علاقه‌مندی یافت نشد", 404);

    await db.favorite.delete({ where: { id: fav.id } });
    return ok({ message: "از علاقه‌مندی‌ها حذف شد" });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

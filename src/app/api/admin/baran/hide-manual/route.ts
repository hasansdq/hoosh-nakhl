import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";

/**
 * منوی کاملاً بارانی — /api/admin/baran/hide-manual
 * ---------------------------------------------------------------------------
 * «منو را کلاً بر مبنای داده‌های باران» می‌کند:
 *  • همهٔ اقلام بدون اتصال باران (اقلام دستی/دمو) از فهرست منو مخفی می‌شوند
 *    (حذف فیزیکی نیست — از «مدیریت منو» قابل بازگردانی است)
 *  • دسته‌های بدون اتصال باران که دیگر قلم فعالی ندارند غیرفعال می‌شوند
 */
export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const hiddenItems = await db.menuItem.updateMany({
      where: { baranProductId: null, isAvailable: true },
      data: { isAvailable: false },
    });

    // دسته‌های دستی که هیچ قلم فعالی ندارند
    const manualCategories = await db.category.findMany({
      where: { baranGroupId: null },
      select: { id: true, items: { select: { isAvailable: true } } },
    });
    const emptyManualIds = manualCategories
      .filter((c) => !c.items.some((i) => i.isAvailable))
      .map((c) => c.id);
    let deactivatedCategories = 0;
    if (emptyManualIds.length) {
      const res = await db.category.updateMany({
        where: { id: { in: emptyManualIds }, isActive: true },
        data: { isActive: false },
      });
      deactivatedCategories = res.count;
    }

    await logAudit(session.admin.username, "BARAN_HIDE_MANUAL_ITEMS", {
      entity: "menuItem",
      detail: { hiddenItems: hiddenItems.count, deactivatedCategories },
      ip: getClientIp(req),
    });

    return ok({ hiddenItems: hiddenItems.count, deactivatedCategories });
  } catch (e) {
    console.error("baran hide-manual error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

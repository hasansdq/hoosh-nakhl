import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { toJalali } from "@/lib/fa";
import { productsToCsv, type ProductCsvExportRow } from "@/lib/products-csv";

/**
 * برون‌بری کامل محصولات به CSV — /api/admin/tools/products/export
 * ---------------------------------------------------------------------------
 * • UTF-8 با BOM برای نمایش صحیح فارسی در Excel
 * • همهٔ اطلاعات غیرتصویری + «شناسه» برای همگام‌سازی دقیق رفت‌وبرگشت
 * • دادهٔ تصویر (imageUrl / gallery) عمداً در خروجی نیست
 * • «تعداد سفارش» صرفاً اطلاعاتی است و در درون‌ریزی نادیده گرفته می‌شود
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const items = await db.menuItem.findMany({
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { createdAt: "asc" }],
      include: { category: { select: { name: true } } },
    });

    const rows: ProductCsvExportRow[] = items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category.name,
      price: i.price,
      description: i.description,
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
    }));

    const csv = productsToCsv(rows);

    const j = toJalali(new Date());
    const filename = `nakhl-products-${j.jy}-${String(j.jm).padStart(2, "0")}-${String(j.jd).padStart(2, "0")}.csv`;

    await logAudit(session.admin.username, "MENU_CSV_EXPORT", {
      entity: "menuItem",
      detail: { count: rows.length },
      ip: getClientIp(req),
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("products csv export error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

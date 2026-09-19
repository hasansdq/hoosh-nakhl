import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { PRODUCT_CSV_HEADERS, productsToCsv, type ProductCsvExportRow } from "@/lib/products-csv";

/**
 * فایل نمونهٔ CSV محصولات — /api/admin/tools/products/template
 * ---------------------------------------------------------------------------
 * • سرستون‌های رسمی + سه ردیف نمونه (کامل / حداقلی / با نقل‌قول)
 * • نام دسته‌بندی‌های واقعی رستوران در ردیف‌های نمونه درج می‌شود تا
 *   مدیر دقیقاً املای صحیح را ببیند.
 * • شناسه در ردیف‌های نمونه خالی است ← درون‌ریزی = افزودن محصول جدید
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const categories = await db.category.findMany({
      orderBy: { sortOrder: "asc" },
      select: { name: true },
      take: 3,
    });

    const cat1 = categories[0]?.name ?? "دستهٔ نمونه ۱";
    const cat2 = categories[1]?.name ?? "دستهٔ نمونه ۲";
    const cat3 = categories[2]?.name ?? cat1;

    const samples: ProductCsvExportRow[] = [
      {
        id: "",
        name: "نمونهٔ کامل — این ردیف را ویرایش کنید",
        category: cat1,
        price: 285000,
        description:
          "نمونهٔ ردیف کامل: توضیح، کالری، زمان آماده‌سازی و مواد تشکیل‌دهنده. متن‌های طولانی و علامت «،» به‌صورت خودکار داخل نقل‌قول قرار می‌گیرند.",
        isAvailable: true,
        isSpecial: true,
        isDrink: false,
        isVegetarian: false,
        isSpicy: true,
        calories: 750,
        prepTime: 25,
        ingredients: "مواد اولیه با ، و ؛ و جدا می‌شوند",
        sortOrder: 10,
        orderCount: 0,
      },
      {
        id: "",
        name: "نمونهٔ حداقلی — فقط نام، دسته و قیمت",
        category: cat2,
        price: 120000,
        description: null,
        isAvailable: true,
        isSpecial: false,
        isDrink: false,
        isVegetarian: true,
        isSpicy: false,
        calories: null,
        prepTime: null,
        ingredients: null,
        sortOrder: 20,
        orderCount: 0,
      },
      {
        id: "",
        name: "نمونهٔ اعداد فارسی — قیمت با ارقام ۰۱۲",
        category: cat3,
        price: 98000,
        description: "در درون‌ریزی، ارقام فارسی/انگلیسی و جداکنندهٔ هزارگان هر دو پذیرفته می‌شوند.",
        isAvailable: true,
        isSpecial: false,
        isDrink: true,
        isVegetarian: false,
        isSpicy: false,
        calories: 120,
        prepTime: 5,
        ingredients: null,
        sortOrder: 30,
        orderCount: 0,
      },
    ];

    const csv = productsToCsv(samples);

    await logAudit(session.admin.username, "MENU_CSV_TEMPLATE", {
      entity: "menuItem",
      detail: { columns: PRODUCT_CSV_HEADERS.length },
      ip: getClientIp(req),
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="nakhl-products-sample.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("products csv template error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { normalizePersian } from "@/lib/fa";
import {
  MAX_CSV_BYTES,
  validateProductsCsv,
  type ImportMode,
  type ImportOptions,
  type ImportOutcome,
  type ImportRowOutcome,
  type ProductCsvRecord,
} from "@/lib/products-csv";

/**
 * درون‌ریزی انبوه محصولات از CSV — POST /api/admin/tools/products/import
 * ---------------------------------------------------------------------------
 * ورودی: multipart/form-data
 *   file              فایل CSV (الزامی، حداکثر ۲MB / ۵۰۰۰ ردیف)
 *   mode              sync (به‌روزرسانی و افزودن) | create-only (فقط افزودن)
 *   createCategories  true|false — ساخت خودکار دسته‌بندی‌های جدید
 * (JSON با { csv, mode, createCategories } هم پذیرفته می‌شود)
 *
 * منطق همگام‌سازی:
 *   ۱) «شناسه» موجود و معتبر → همان محصول به‌روزرسانی می‌شود
 *   ۲) وگرنه تطبیق با «نام + دسته‌بندی» → به‌روزرسانی
 *   ۳) وگرنه (حالت sync) → محصول جدید ساخته می‌شود
 *   • ستون غایب ← فیلد دست‌نخورده؛ سلول خالی ← پاک‌شدن/پیش‌فرض
 *   • تصاویر (imageUrl / gallery) هرگز تغییر نمی‌کنند — مالکیت کامل پنل
 *   • «تعداد سفارش» (آمار واقعی) نادیده گرفته می‌شود
 */

const CATEGORY_NAME_MAX = 80;

/** تولید slug یکتا سازگار با الگوی فعلی دسته‌بندی‌ها (cat-…) — بدون وابستگی به Buffer */
function generateCategorySlug(existing: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const slug = `cat-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
    if (!existing.has(slug)) return slug;
  }
  return `cat-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

interface CategoryLite {
  id: string;
  name: string;
  slug: string;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    // ---------- خواندن ورودی (multipart یا JSON) ----------
    let csvText = "";
    let options: ImportOptions = { mode: "sync", createCategories: false };

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => ({}))) as {
        csv?: string;
        mode?: string;
        createCategories?: boolean;
      };
      csvText = typeof body.csv === "string" ? body.csv : "";
      options = {
        mode: body.mode === "create-only" ? "create-only" : "sync",
        createCategories: body.createCategories === true,
      };
    } else {
      const form = await req.formData().catch(() => null);
      if (!form) return fail("درخواست نامعتبر است");
      const file = form.get("file");
      if (!file || typeof file === "string") return fail("فایل CSV انتخاب نشده است");
      if (file.size === 0) return fail("فایل خالی است");
      if (file.size > MAX_CSV_BYTES) {
        return fail("حجم فایل بیش از حد مجاز (۲ مگابایت) است", 413);
      }
      csvText = await file.text();
      const mode = form.get("mode");
      options = {
        mode: mode === "create-only" ? "create-only" : "sync",
        createCategories: form.get("createCategories") === "true",
      };
    }

    if (csvText.length > MAX_CSV_BYTES) {
      return fail("حجم فایل بیش از حد مجاز (۲ مگابایت) است", 413);
    }

    // ---------- اعتبارسنجی با موتور مشترک (همان منطق پیش‌نمایش کلاینت) ----------
    const validation = validateProductsCsv(csvText);
    if (validation.fatal) {
      return fail(validation.fatal, 400, {
        missingRequired: validation.missingRequired,
        unknownColumns: validation.unknownColumns,
      });
    }
    if (validation.rows.length === 0) {
      return fail("هیچ ردیف داده‌ای در فایل یافت نشد", 400);
    }
    if (validation.validCount === 0) {
      return fail("هیچ ردیف معتبری برای درون‌ریزی وجود ندارد — خطاهای ردیف‌ها را بررسی کنید", 400);
    }

    // ---------- بارگذاری نقشه‌های تطبیق ----------
    const [categories, items] = await Promise.all([
      db.category.findMany({ select: { id: true, name: true, slug: true } }),
      db.menuItem.findMany({ select: { id: true, name: true, categoryId: true } }),
    ]);

    const catByName = new Map<string, CategoryLite>();
    const catBySlug = new Map<string, CategoryLite>();
    const slugSet = new Set<string>();
    for (const c of categories) {
      const n = normalizePersian(c.name);
      if (!catByName.has(n)) catByName.set(n, c);
      const s = normalizePersian(c.slug);
      if (!catBySlug.has(s)) catBySlug.set(s, c);
      slugSet.add(c.slug);
    }

    const itemById = new Map<string, { name: string; categoryId: string }>();
    const itemByNameCat = new Map<string, string>(); // `${categoryId}::${normName}` -> id
    for (const it of items) {
      itemById.set(it.id, { name: it.name, categoryId: it.categoryId });
      itemByNameCat.set(`${it.categoryId}::${normalizePersian(it.name)}`, it.id);
    }

    // ---------- پردازش ردیف‌ها ----------
    const outcomes: ImportRowOutcome[] = [];
    const categoriesCreated: { name: string; slug: string }[] = [];
    const touchedItems = new Map<string, number>(); // itemId -> اولین ردیفی که آن را لمس کرد
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    const resolveCategory = async (
      rec: ProductCsvRecord
    ): Promise<{ cat: CategoryLite | null; error?: string }> => {
      const norm = normalizePersian(rec.category);
      const existing = catByName.get(norm) ?? catBySlug.get(norm);
      if (existing) return { cat: existing };
      if (!options.createCategories) {
        return {
          cat: null,
          error: `دسته‌بندی «${rec.category}» یافت نشد (برای ساخت خودکار، گزینهٔ مربوطه را فعال کنید)`,
        };
      }
      if (rec.category.length > CATEGORY_NAME_MAX) {
        return { cat: null, error: "نام دسته‌بندی بیش از حد بلند است" };
      }
      try {
        const cat = await db.category.create({
          data: {
            name: rec.category,
            slug: generateCategorySlug(slugSet),
            sortOrder: 99,
            isActive: true,
          },
        });
        slugSet.add(cat.slug);
        catByName.set(norm, cat);
        catBySlug.set(normalizePersian(cat.slug), cat);
        categoriesCreated.push({ name: cat.name, slug: cat.slug });
        return { cat };
      } catch (e) {
        console.error("import category create error:", e);
        return { cat: null, error: "خطا در ساخت دسته‌بندی جدید" };
      }
    };

    for (const vr of validation.rows) {
      if (!vr.record) {
        failed++;
        outcomes.push({
          row: vr.row,
          name: "—",
          action: "error",
          message: vr.errors.join("؛ "),
        });
        continue;
      }
      const rec = vr.record;

      try {
        const { cat, error: catError } = await resolveCategory(rec);
        if (!cat) {
          failed++;
          outcomes.push({ row: vr.row, name: rec.name, action: "error", message: catError });
          continue;
        }

        // تطبیق محصول موجود: ابتدا شناسه، سپس نام+دسته
        const notes: string[] = [...vr.warnings];
        let existingId: string | null = null;
        if (rec.id) {
          if (itemById.has(rec.id)) {
            existingId = rec.id;
          } else {
            notes.push("شناسه در سیستم یافت نشد — تطبیق با نام و دسته‌بندی انجام شد");
          }
        }
        if (!existingId) {
          existingId = itemByNameCat.get(`${cat.id}::${normalizePersian(rec.name)}`) ?? null;
        }

        // هشدار لمسِ دوبارهٔ یک محصول در همین فایل
        if (existingId && touchedItems.has(existingId)) {
          notes.push(`این محصول قبلاً در ردیف ${touchedItems.get(existingId)} در همین فایل پردازش شد — آخرین مقدار اعمال می‌شود`);
        }

        // ---------- حالت «فقط افزودن» ----------
        if (options.mode === "create-only" && existingId) {
          skipped++;
          outcomes.push({
            row: vr.row,
            name: rec.name,
            action: "skipped",
            message: "محصول از قبل وجود دارد (حالت فقط افزودن)",
          });
          continue;
        }

        if (existingId) {
          if (!touchedItems.has(existingId)) touchedItems.set(existingId, vr.row);

          // به‌روزرسانی — فقط فیلدهایی که ستونشان در فایل حاضر است
          const fp = rec.fieldsPresent;
          const data: Record<string, unknown> = {};
          if (fp.has("name")) data.name = rec.name;
          if (fp.has("price")) data.price = rec.price;
          if (fp.has("category")) data.categoryId = cat.id;
          if (fp.has("description")) data.description = rec.description;
          if (fp.has("isAvailable")) data.isAvailable = rec.isAvailable;
          if (fp.has("isSpecial")) data.isSpecial = rec.isSpecial;
          if (fp.has("isDrink")) data.isDrink = rec.isDrink;
          if (fp.has("isVegetarian")) data.isVegetarian = rec.isVegetarian;
          if (fp.has("isSpicy")) data.isSpicy = rec.isSpicy;
          if (fp.has("calories")) data.calories = rec.calories;
          if (fp.has("prepTime")) data.prepTime = rec.prepTime;
          if (fp.has("ingredients")) data.ingredients = rec.ingredients;
          if (fp.has("sortOrder")) data.sortOrder = rec.sortOrder;

          await db.menuItem.update({ where: { id: existingId }, data });

          // به‌روزرسانی نقشهٔ نام+دسته (نام/دسته ممکن است تغییر کند)
          const prev = itemById.get(existingId);
          if (prev) {
            itemByNameCat.delete(`${prev.categoryId}::${normalizePersian(prev.name)}`);
          }
          const newCat = fp.has("category") ? cat.id : prev?.categoryId ?? cat.id;
          const newName = fp.has("name") ? rec.name : prev?.name ?? rec.name;
          itemById.set(existingId, { name: newName, categoryId: newCat });
          itemByNameCat.set(`${newCat}::${normalizePersian(newName)}`, existingId);

          updated++;
          outcomes.push({
            row: vr.row,
            name: rec.name,
            action: "updated",
            message: notes.length ? notes.join("؛ ") : undefined,
          });
          continue;
        }

        // ---------- ایجاد محصول جدید (بدون تصویر — مالکیت پنل مدیریت) ----------
        const fp = rec.fieldsPresent;
        const createdItem = await db.menuItem.create({
          data: {
            name: rec.name,
            price: rec.price,
            categoryId: cat.id,
            description: fp.has("description") ? rec.description : null,
            isAvailable: fp.has("isAvailable") ? rec.isAvailable : true,
            isSpecial: fp.has("isSpecial") ? rec.isSpecial : false,
            isDrink: fp.has("isDrink") ? rec.isDrink : cat.slug === "drinks",
            isVegetarian: fp.has("isVegetarian") ? rec.isVegetarian : false,
            isSpicy: fp.has("isSpicy") ? rec.isSpicy : false,
            calories: fp.has("calories") ? rec.calories : null,
            prepTime: fp.has("prepTime") ? rec.prepTime : null,
            ingredients: fp.has("ingredients") ? rec.ingredients : null,
            sortOrder: fp.has("sortOrder") ? rec.sortOrder : 0,
          },
        });

        itemById.set(createdItem.id, { name: createdItem.name, categoryId: cat.id });
        itemByNameCat.set(`${cat.id}::${normalizePersian(createdItem.name)}`, createdItem.id);
        touchedItems.set(createdItem.id, vr.row);

        created++;
        outcomes.push({
          row: vr.row,
          name: rec.name,
          action: "created",
          message: notes.length ? notes.join("؛ ") : undefined,
        });
      } catch (e) {
        console.error(`import row ${vr.row} error:`, e);
        failed++;
        outcomes.push({
          row: vr.row,
          name: rec.name,
          action: "error",
          message: "خطای غیرمنتظره در پردازش این ردیف",
        });
      }
    }

    const result: ImportOutcome = {
      totalRows: validation.rows.length,
      created,
      updated,
      skipped,
      failed,
      rows: outcomes,
      categoriesCreated,
      durationMs: Date.now() - startedAt,
    };

    await logAudit(session.admin.username, "MENU_CSV_IMPORT", {
      entity: "menuItem",
      detail: {
        total: result.totalRows,
        created,
        updated,
        skipped,
        failed,
        categoriesCreated: categoriesCreated.length,
        mode: options.mode,
      },
      ip: getClientIp(req),
    });

    return ok({ result });
  } catch (e) {
    console.error("products csv import error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

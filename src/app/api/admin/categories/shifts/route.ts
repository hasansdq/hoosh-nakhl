import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";

// ============ PUT /api/admin/categories/shifts — انتخاب دسته‌های «فقط شیفت شب» ============
// تنظیمات → عمومی → شیفت‌بندی منو: آدمین دسته‌هایی را انتخاب می‌کند که
// غذاهایشان فقط در سرویس شام قابل سفارش‌اند. کل مجموعه به‌صورت اتمیک ست می‌شود.

export async function PUT(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const body = (await req.json().catch(() => ({}))) as { dinnerOnlyIds?: unknown };
    const rawIds = Array.isArray(body.dinnerOnlyIds) ? body.dinnerOnlyIds : null;
    if (!rawIds) return fail("ساختار داده نامعتبر است");
    const ids = [...new Set(rawIds.filter((v): v is string => typeof v === "string" && v.length > 0))];

    // اعتبارسنجی: همهٔ شناسه‌ها باید متعلق به دسته‌های واقعی باشند
    const found = await db.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    if (found.length !== ids.length) return fail("برخی دسته‌های انتخاب‌شده یافت نشدند", 404);

    const before = await db.category.findMany({ where: { dinnerOnly: true }, select: { id: true, name: true } });
    const beforeIds = new Set(before.map((c) => c.id));

    // به‌روزرسانی اتمیک نتیجه: دسته‌های تازه انتخاب‌شده روشن، بقیه خاموش
    // (کلاینت D1 آرایهٔ $transaction را پشتیبانی نمی‌کند — به‌روزرسانی‌های ترتیبیِ idempotent)
    const toTurnOff = await db.category.findMany({ where: { dinnerOnly: true, id: { notIn: ids } }, select: { id: true } });
    for (const id of ids.filter((id) => !beforeIds.has(id))) {
      await db.category.update({ where: { id }, data: { dinnerOnly: true } });
    }
    for (const c of toTurnOff) {
      await db.category.update({ where: { id: c.id }, data: { dinnerOnly: false } });
    }

    const after = await db.category.findMany({
      where: { dinnerOnly: true },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    });

    await logAudit(session.admin.username, "CATEGORY_SHIFTS_UPDATED", {
      entity: "category",
      entityId: "dinner-only",
      detail: {
        before: before.map((c) => c.name),
        after: after.map((c) => c.name),
      },
      ip: getClientIp(req),
    });

    return ok({
      dinnerOnlyCategories: after,
      message:
        after.length > 0
          ? `${after.length} دسته به‌عنوان «فقط شیفت شب» ثبت شد: ${after.map((c) => c.name).join("، ")}`
          : "هیچ دسته‌ای «فقط شیفت شب» نیست — همهٔ منو در هر دو شیفت قابل سفارش است",
    });
  } catch (e) {
    console.error("category shifts update error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

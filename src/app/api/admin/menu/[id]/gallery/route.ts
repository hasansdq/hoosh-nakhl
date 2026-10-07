import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { saveImageUpload } from "@/lib/uploads";
import { getClientIp } from "@/lib/auth";

const MAX_FILES = 6;
const MAX_PER_FILE = 5 * 1024 * 1024; // 5MB

/**
 * POST /api/admin/menu/[id]/gallery
 * Multipart form-data, field "files" (one or more, up to 6).
 * Optimizes each image via the existing sharp helper (food variant) and
 * returns the new URLs as an array. The caller then PUTs the menu item with
 * the gallery array (merged with existing gallery) to persist atomically.
 * Auth: requireAdmin.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const item = await db.menuItem.findUnique({ where: { id }, select: { id: true, gallery: true } });
    if (!item) return fail("آیتم یافت نشد", 404);

    const form = await req.formData().catch(() => null);
    if (!form) return fail("فرم چندبخشی ارسال نشده است");

    const entries = form.getAll("files").filter((e): e is File => e instanceof File);
    if (entries.length === 0) return fail("هیچ فایلی ارسال نشده است");
    if (entries.length > MAX_FILES) {
      return fail(`حداکثر ${MAX_FILES} فایل در هر بار قابل آپلود است`);
    }

    for (const f of entries) {
      if (f.size > MAX_PER_FILE) {
        return fail(`حجم فایل «${f.name}» بیش از ۵ مگابایت است`);
      }
    }

    const uploaded: string[] = [];
    const errors: { name: string; error: string }[] = [];
    for (const file of entries) {
      const result = await saveImageUpload(file, {
        kind: "food",
        uploadedBy: `admin:${session.admin.username}`,
      });
      if (result.success && result.url) {
        uploaded.push(result.url);
      } else {
        errors.push({ name: file.name, error: result.error ?? "خطا در آپلود" });
      }
    }

    if (uploaded.length === 0) {
      return fail(errors[0]?.error ?? "هیچ فایلی آپلود نشد");
    }

    await logAudit(session.admin.username, "MENU_GALLERY_UPLOADED", {
      entity: "menuItem",
      entityId: id,
      detail: { count: uploaded.length, urls: uploaded, errors },
      ip: getClientIp(req),
    });

    return ok({ urls: uploaded, errors });
  } catch (e) {
    console.error("gallery upload error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

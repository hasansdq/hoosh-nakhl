import { NextRequest } from "next/server";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { saveImageUpload } from "@/lib/uploads";

/**
 * POST /api/admin/upload — generic admin image upload (multipart/form-data,
 * field `file`). Used by the CMS content manager (hero/login/footer images)
 * and the menu editor. Files land in the R2 bucket and are served from
 * `/f/<key>`.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return fail("فایل تصویر ارسال نشده است");

    const result = await saveImageUpload(file, {
      kind: "general",
      uploadedBy: `admin:${session.admin.username}`,
    });
    if (!result.success || !result.url) {
      return fail(result.error ?? "خطا در آپلود تصویر");
    }

    await logAudit(session.admin.username, "CONTENT_IMAGE_UPLOADED", {
      entity: "upload",
      detail: { url: result.url, size: result.size, filename: file.name },
      ip: getClientIp(req),
    });

    return ok({ url: result.url, size: result.size });
  } catch (e) {
    console.error("admin upload error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

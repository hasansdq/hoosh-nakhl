import { NextRequest } from "next/server";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { saveImageUpload, type ImageKind } from "@/lib/uploads";

/**
 * POST /api/admin/upload — generic admin image upload (multipart/form-data,
 * field `file`, optional field `kind`: food | avatar | general).
 *
 * Used by the menu editor (main food image, kind=food) and the CMS content
 * manager (site images, kind defaults to general). Files land on the active
 * storage backend (Cloudflare R2 on Workers / the Docker volume on VPS) and
 * are served from `/f/<key>`.
 *
 * HISTORY NOTE (upload-404 regression): this endpoint was accidentally
 * removed during the docker-1 repo cleanup while both clients kept POSTing
 * to it — every admin image upload returned 404 in production. It was
 * restored once (docker-2) but never committed and lost again. It is now a
 * PERMANENT, committed route — both upload UIs depend on it.
 */
const KINDS: readonly ImageKind[] = ["food", "avatar", "general"] as const;

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return fail("فایل تصویر ارسال نشده است");

    const rawKind = form?.get("kind");
    const kind: ImageKind =
      typeof rawKind === "string" && (KINDS as readonly string[]).includes(rawKind)
        ? (rawKind as ImageKind)
        : "general";

    const result = await saveImageUpload(file, {
      kind,
      uploadedBy: `admin:${session.admin.username}`,
    });
    if (!result.success || !result.url) {
      return fail(result.error ?? "خطا در آپلود تصویر");
    }

    await logAudit(session.admin.username, "ADMIN_IMAGE_UPLOADED", {
      entity: "upload",
      detail: { kind, url: result.url, size: result.size, filename: file.name },
      ip: getClientIp(req),
    });

    return ok({ url: result.url, size: result.size, filename: result.filename });
  } catch (e) {
    console.error("admin upload error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

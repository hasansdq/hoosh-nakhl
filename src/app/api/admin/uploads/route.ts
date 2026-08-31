import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { deleteUploadByUrl } from "@/lib/uploads";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const page = Math.max(1, Number(new URL(req.url).searchParams.get("page") ?? 1));
    const pageSize = 24;
    const [uploads, total] = await Promise.all([
      db.upload.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
      db.upload.count(),
    ]);

    return ok({
      uploads: uploads.map((u) => ({
        id: u.id, filename: u.filename, url: u.url, mimeType: u.mimeType,
        size: u.size, uploadedBy: u.uploadedBy, createdAt: u.createdAt.toISOString(),
      })),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const body = (await req.json().catch(() => ({}))) as { url?: string };
    if (!body.url) return fail("آدرس فایل لازم است");

    const deleted = await deleteUploadByUrl(body.url);
    if (!deleted) return fail("فایل یافت نشد", 404);

    await logAudit(session.admin.username, "UPLOAD_DELETED", { detail: { url: body.url } });
    return ok({ message: "فایل حذف شد" });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

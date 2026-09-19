import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { saveImageUpload } from "@/lib/uploads";

/** POST — avatar upload (multipart/form-data with file field) */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return fail("فایل تصویر ارسال نشده است");

    const result = await saveImageUpload(file, { kind: "avatar", uploadedBy: user.id });
    if (!result.success || !result.url) return fail(result.error ?? "خطا در آپلود");

    // persist the avatar on the user record — previously the file was stored
    // but user.avatarUrl was never updated, so the profile never showed it
    await db.user.update({ where: { id: user.id }, data: { avatarUrl: result.url } });

    return ok({ url: result.url, size: result.size });
  } catch (e) {
    console.error("avatar upload error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

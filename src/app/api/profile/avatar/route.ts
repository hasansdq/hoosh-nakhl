import { NextRequest } from "next/server";
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
    if (!result.success) return fail(result.error ?? "خطا در آپلود");

    return ok({ url: result.url, size: result.size });
  } catch (e) {
    console.error("avatar upload error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

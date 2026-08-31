import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser, publicUser, logAudit } from "@/lib/api";
import { profileUpdateSchema } from "@/lib/validators";
import { parseJalaliDate, isValidNationalId } from "@/lib/fa";

export async function GET() {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);
    return ok({ user: publicUser(user) });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const body = await req.json().catch(() => ({}));
    const parsed = profileUpdateSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");
    const d = parsed.data;

    if (d.nationalId && !isValidNationalId(d.nationalId)) {
      return fail("کد ملی نامعتبر است");
    }
    const birthDate = d.birthDate ? parseJalaliDate(d.birthDate) : undefined;
    if (d.birthDate && !birthDate) return fail("تاریخ تولد نامعتبر است (مثال: ۱۳۷۵/۰۳/۱۲)");

    // dietary prefs: canonical JSON string (null when never saved)
    const dietaryPrefs = d.dietaryPrefs !== undefined ? JSON.stringify(d.dietaryPrefs) : undefined;

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        ...(d.firstName !== undefined && { firstName: d.firstName || null }),
        ...(d.lastName !== undefined && { lastName: d.lastName || null }),
        ...(d.nationalId !== undefined && { nationalId: d.nationalId || null }),
        ...(d.email !== undefined && { email: d.email || null }),
        ...(d.gender !== undefined && { gender: d.gender || null }),
        ...(d.avatarUrl !== undefined && { avatarUrl: d.avatarUrl || null }),
        ...(birthDate && { birthDate }),
        ...(dietaryPrefs !== undefined && { dietaryPrefs }),
      },
    });

    await logAudit(user.id, "PROFILE_UPDATED", { entity: "user", entityId: user.id });
    return ok({ user: publicUser(updated) });
  } catch (e) {
    console.error("profile update error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

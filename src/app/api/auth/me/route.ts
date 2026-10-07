import { ok, fail, requireUser, publicUser } from "@/lib/api";
import { destroyUserSession } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireUser();
    if (!user) return fail("وارد نشده‌اید", 401);
    return ok({ user: publicUser(user) });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function DELETE() {
  await destroyUserSession();
  return ok({ message: "با موفقیت خارج شدید" });
}

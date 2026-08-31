import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireUser } from "@/lib/api";
import { addressSchema } from "@/lib/validators";

export async function GET() {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const addresses = await db.address.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return ok({ addresses });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return fail("ابتدا وارد شوید", 401);

    const body = await req.json().catch(() => ({}));
    const parsed = addressSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");

    const count = await db.address.count({ where: { userId: user.id } });
    if (count >= 10) return fail("حداکثر ۱۰ آدرس می‌توانید ذخیره کنید");

    const isDefault = parsed.data.isDefault || count === 0;
    if (isDefault) {
      await db.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    }

    const address = await db.address.create({
      data: {
        userId: user.id,
        title: parsed.data.title,
        fullAddress: parsed.data.fullAddress,
        postalCode: parsed.data.postalCode || null,
        isDefault,
      },
    });
    return ok({ address });
  } catch (e) {
    console.error("address create error:", e);
    return fail("خطای داخلی سرور", 500);
  }
}

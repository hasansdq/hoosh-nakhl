import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { normalizeCouponCode } from "@/lib/coupons";
import { z } from "zod";

const couponSchema = z.object({
  code: z.string().trim().min(3, "کد حداقل ۳ نویسه").max(24, "کد حداکثر ۲۴ نویسه"),
  title: z.string().trim().min(2, "عنوان را وارد کنید").max(80),
  type: z.enum(["PERCENT", "FIXED"]),
  value: z.number().int().min(1, "مقدار تخفیف نامعتبر است"),
  minOrder: z.number().int().min(0).max(500_000_000).optional(),
  maxDiscount: z.number().int().min(0).max(500_000_000).optional().nullable(),
  usageLimit: z.number().int().min(0).max(100000).optional(),
  perUserLimit: z.number().int().min(0).max(1000).optional(),
  startsAt: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET() {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const coupons = await db.coupon.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { orders: true } } },
    });
    return ok({
      coupons: coupons.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        type: c.type,
        value: c.value,
        minOrder: c.minOrder,
        maxDiscount: c.maxDiscount,
        usageLimit: c.usageLimit,
        usedCount: c.usedCount,
        perUserLimit: c.perUserLimit,
        startsAt: c.startsAt?.toISOString() ?? null,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        isActive: c.isActive,
        ordersCount: c._count.orders,
      })),
    });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const body = await req.json().catch(() => ({}));
    const parsed = couponSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "داده نامعتبر");

    const data = parsed.data;
    if (data.type === "PERCENT" && data.value > 100) {
      return fail("درصد تخفیف نمی‌تواند بیش از ۱۰۰ باشد");
    }
    if (data.type === "FIXED" && data.value < 1000) {
      return fail("مبلغ تخفیف حداقل ۱,۰۰۰ تومان است");
    }

    const code = normalizeCouponCode(data.code);
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) {
      return fail("کد تخفیف فقط می‌تواند شامل حروف انگلیسی، رقم، خط تیره و زیرخط باشد");
    }

    const exists = await db.coupon.findUnique({ where: { code } });
    if (exists) return fail("این کد قبلاً ثبت شده است");

    const coupon = await db.coupon.create({
      data: {
        code,
        title: data.title,
        type: data.type,
        value: data.value,
        minOrder: data.minOrder ?? 0,
        maxDiscount: data.maxDiscount && data.maxDiscount > 0 ? data.maxDiscount : null,
        usageLimit: data.usageLimit ?? 0,
        perUserLimit: data.perUserLimit ?? 1,
        startsAt: parseDate(data.startsAt),
        expiresAt: parseDate(data.expiresAt),
        isActive: data.isActive ?? true,
      },
    });

    await logAudit(session.admin.username, "COUPON_CREATED", {
      entity: "coupon",
      entityId: coupon.id,
      detail: { code: coupon.code, type: coupon.type, value: coupon.value },
      ip: getClientIp(req),
    });
    return ok({ coupon });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

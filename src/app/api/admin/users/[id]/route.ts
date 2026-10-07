import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, fail, requireAdmin, logAudit } from "@/lib/api";
import { getClientIp } from "@/lib/auth";
import { z } from "zod";

const updateSchema = z.object({
  status: z.enum(["ACTIVE", "BLOCKED"]).optional(),
  note: z.string().max(500).optional(),
});

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const user = await db.user.findUnique({ where: { id } });
    if (!user) return fail("کاربر یافت نشد", 404);

    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return fail("داده نامعتبر");

    await db.user.update({
      where: { id },
      data: {
        ...(parsed.data.status && { status: parsed.data.status }),
        ...(parsed.data.note !== undefined && { note: parsed.data.note }),
      },
    });

    if (parsed.data.status === "BLOCKED") {
      // revoke sessions
      await db.session.deleteMany({ where: { userId: id } });
    }

    await logAudit(session.admin.username, parsed.data.status === "BLOCKED" ? "USER_BLOCKED" : "USER_UPDATED", {
      entity: "user",
      entityId: id,
      ip: getClientIp(req),
    });
    return ok({ message: "کاربر به‌روزرسانی شد" });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    if (!session) return fail("دسترسی غیرمجاز", 401);

    const { id } = await ctx.params;
    const user = await db.user.findUnique({
      where: { id },
      include: {
        orders: { orderBy: { createdAt: "desc" }, take: 20, select: { orderNumber: true, status: true, total: true, paymentStatus: true, createdAt: true } },
        addresses: true,
      },
    });
    if (!user) return fail("کاربر یافت نشد", 404);

    return ok({
      user: {
        id: user.id, phone: user.phone, firstName: user.firstName, lastName: user.lastName,
        nationalId: user.nationalId, email: user.email, birthDate: user.birthDate?.toISOString() ?? null,
        gender: user.gender, avatarUrl: user.avatarUrl, status: user.status, note: user.note,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null, createdAt: user.createdAt.toISOString(),
        orders: user.orders.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() })),
        addresses: user.addresses,
      },
    });
  } catch {
    return fail("خطای داخلی سرور", 500);
  }
}
